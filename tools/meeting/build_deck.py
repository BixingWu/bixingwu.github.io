"""Assemble a standalone meeting deck while retaining the template's navigation and notes."""

import argparse
import base64
import html
from html.parser import HTMLParser
import json
import mimetypes
from pathlib import Path
import re
import shutil
import subprocess
from tempfile import NamedTemporaryFile
from urllib.parse import unquote, urlsplit


MEDIA_ATTRIBUTES = {
    "img": {"src": ("image/",), "srcset": ("image/",)},
    "image": {"href": ("image/",), "xlink:href": ("image/",)},
    "video": {"src": ("video/",), "poster": ("image/",)},
    "audio": {"src": ("audio/",)},
    "source": {"src": ("audio/", "video/"), "srcset": ("image/",)},
    "track": {"src": ("text/vtt",)},
}
ATTRIBUTE = re.compile(r"""(\s+)([^\s=/<>]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""")


def embed_url(value, fragment, allowed_types):
    url = value.strip()
    if url.lower().startswith("data:") or url.startswith("#"):
        return value
    parts = urlsplit(url)
    if parts.scheme or parts.netloc or not parts.path:
        raise ValueError(f"{fragment}: use a local media file or data URI for {url!r}")
    path = fragment.parent / unquote(parts.path)
    mime = mimetypes.guess_type(path.name)[0] or ""
    if not mime.startswith(allowed_types):
        raise ValueError(f"{fragment}: unexpected media type for {url!r}")
    if not path.is_file():
        raise ValueError(f"{fragment}: media file does not exist: {url!r}")
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    anchor = "#" + parts.fragment if parts.fragment else ""
    return f"data:{mime};base64,{payload}{anchor}"


def embed_srcset(value, fragment):
    # A srcset URL can itself contain commas, particularly in a data URI.
    candidates = []
    rest = value.strip()
    while rest:
        token = re.match(r"[^\s]+", rest).group()
        rest = rest[len(token):].lstrip()
        url = token.rstrip(",")
        descriptor = ""
        if url == token:
            descriptor, _, rest = rest.partition(",")
            rest = rest.lstrip()
        source = embed_url(url, fragment, ("image/",))
        candidates.append((source + " " + descriptor.strip()).rstrip())
    return ", ".join(candidates)


class FragmentMedia(HTMLParser):
    def __init__(self, content, fragment):
        super().__init__()
        self.fragment = fragment
        self.line_starts = [0] + [m.end() for m in re.finditer("\n", content)]
        self.edits = []

    def handle_starttag(self, tag, attrs):
        media_attrs = MEDIA_ATTRIBUTES.get(tag)
        if not media_attrs:
            return
        changes = {}
        for key, value in attrs:
            if key not in media_attrs or value is None:
                continue
            embedded = (embed_srcset(value, self.fragment) if key == "srcset"
                        else embed_url(value, self.fragment, media_attrs[key]))
            if embedded != value:
                changes[key] = html.escape(embedded, quote=True)
        if changes:
            opening = self.get_starttag_text()

            def replace(match):
                space, name = match.groups()
                if name.lower() not in changes:
                    return match.group()
                return f'{space}{name}="{changes[name.lower()]}"'

            line, column = self.getpos()
            offset = self.line_starts[line - 1] + column
            self.edits.append((offset, offset + len(opening), ATTRIBUTE.sub(replace, opening)))


def read_fragment(path):
    content = path.read_text(encoding="utf-8").strip()
    parser = FragmentMedia(content, path)
    parser.feed(content)
    parser.close()
    chunks = []
    offset = 0
    for start, end, tag in parser.edits:
        chunks.extend((content[offset:start], tag))
        offset = end
    chunks.append(content[offset:])
    return "".join(chunks)


def slide_files(paths):
    for path in paths:
        if path.is_dir():
            parts = sorted(p for p in path.glob("*.html") if p.is_file())
            if not parts:
                raise ValueError(f"{path}: no slide fragments (*.html) found")
            yield from parts
        else:
            yield path


class Slides(HTMLParser):
    def __init__(self):
        super().__init__()
        self.openings = []
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        if tag == "section":
            if self.depth == 0 and "slide" in (dict(attrs).get("class") or "").split():
                self.openings.append((self.getpos(), self.get_starttag_text(), attrs))
            self.depth += 1

    def handle_endtag(self, tag):
        if tag == "section":
            self.depth = max(0, self.depth - 1)


def validate_note_pages(openings):
    owners = {}
    for number, (_, _, attrs) in enumerate(openings, start=1):
        raw = next((value for name, value in attrs if name == "data-note-page"), str(number))
        digits = (raw or "").strip().lstrip("0")
        if not re.fullmatch(r"[0-9]{1,16}", digits) or int(digits) > 2**53 - 1:
            raise ValueError(f"Slide {number}: data-note-page must be a positive safe integer in decimal notation.")
        slot = int(digits)
        if slot in owners:
            raise ValueError(f"Slides {owners[slot]} and {number} share notes slot {slot}. "
                             "Keep the existing slide's slot and assign a new data-note-page to the other slide.")
        owners[slot] = number


def assemble(template, slides, title, css="", script="", *, check_note_pages=False):
    start = "<!-- deck-slides:start -->"
    end = "<!-- deck-slides:end -->"
    if template.count(start) != 1 or template.count(end) != 1:
        raise ValueError("Expected one marked slide area in the Web template")
    parsed = Slides()
    parsed.feed(slides)
    if not parsed.openings:
        raise ValueError('The content needs at least one <section class="slide">')
    if check_note_pages:
        validate_note_pages(parsed.openings)
    if re.search(r"</style\s*>", css, re.I) or re.search(r"</script\s*>", script, re.I):
        raise ValueError("Supply plain CSS or JavaScript without closing HTML tags")
    head, rest = template.split(start)
    _, tail = rest.split(end)
    head, updated = re.subn(r"<title>[^<]*</title>", lambda _: "<title>" + html.escape(title) + "</title>", head, count=1)
    if not updated:
        raise ValueError("The Web template needs a document title")
    if css:
        head = head.replace("</head>", "<style>\n" + css + "\n</style>\n</head>", 1)
    if script:
        tail = tail.replace("</body>", "<script>\n" + script + "\n</script>\n</body>", 1)
    return head + start + "\n" + slides.strip() + "\n" + end + tail


def add_previews(page):
    bundled_node = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
    node = str(bundled_node) if bundled_node.is_file() else shutil.which("node")
    if not node:
        raise RuntimeError("Slide previews need Node.js, Playwright and Chrome. Use --no-previews for a title-only sidebar.")
    renderer = Path(__file__).with_name("render_previews.cjs")
    result = subprocess.run([node, str(renderer)], input=page, text=True, stdout=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError("Slide preview rendering failed. Use --no-previews if a title-only sidebar is intended.")
    previews = json.loads(result.stdout)
    head, start, content = page.partition("<!-- deck-slides:start -->")
    content, end, tail = content.partition("<!-- deck-slides:end -->")
    parsed = Slides()
    parsed.feed(content)
    if len(parsed.openings) != len(previews):
        raise ValueError('Each slide section must be a direct child of the slide container.')
    # Replace only the opening tags; preserve the authored markup, CSS and scripts verbatim.
    line_starts = [0] + [match.end() for match in re.finditer("\n", content)]
    parts = [head, start]
    cursor = 0
    for ((line, column), opening, attrs), preview in zip(parsed.openings, previews):
        offset = line_starts[line - 1] + column
        parts.append(content[cursor:offset])
        cursor = offset + len(opening)
        prefix = opening[:-1].rstrip()
        if any(name == "data-preview" for name, _ in attrs):
            prefix = "<section" + "".join(" " + name + (
                '="' + html.escape(value, quote=True) + '"' if value is not None else ""
            ) for name, value in attrs if name != "data-preview")
        parts.append(prefix + ' data-preview="' + preview + '">')
    return "".join(parts) + content[cursor:] + end + tail


def read_project(path):
    try:
        project = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"{path}: invalid JSON on line {error.lineno}: {error.msg}") from error
    if not isinstance(project, dict):
        raise ValueError(f"{path}: expected a JSON object")
    unknown = project.keys() - {"title", "slides", "output", "css", "js"}
    if unknown:
        raise ValueError(f"{path}: unknown field(s): {', '.join(sorted(unknown))}")
    title = project.get("title")
    slides = project.get("slides")
    if not isinstance(title, str) or not title.strip():
        raise ValueError(f"{path}: title must be a nonempty string")
    if not isinstance(slides, list) or not slides:
        raise ValueError(f"{path}: slides must be a nonempty list in presentation order")

    def relative_path(value, field):
        if not isinstance(value, str) or not value.strip() or Path(value).is_absolute():
            raise ValueError(f"{path}: {field} must be a nonempty relative path")
        return path.parent / value

    return {
        "title": title,
        "slides": [relative_path(value, f"slides[{index}]") for index, value in enumerate(slides)],
        "output": relative_path(project.get("output"), "output"),
        **{name: relative_path(project[name], name) for name in ("css", "js") if name in project},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, help="Private JSON file with title, ordered slides, output and optional css/js; paths are relative to this file")
    parser.add_argument("--slides", type=Path, action="append", help="A slide fragment or a folder of *.html fragments sorted by filename; repeat in presentation order")
    parser.add_argument("--title")
    parser.add_argument("--output", type=Path, help="Output HTML (overrides the project's output)")
    parser.add_argument("--css", type=Path)
    parser.add_argument("--js", type=Path)
    parser.add_argument("--no-previews", action="store_true", help="Use slide titles and page numbers without rendering thumbnails")
    args = parser.parse_args()
    tools = Path(__file__).resolve().parent.parent
    template = tools / "slides-template.html"
    if not template.is_file():
        template = tools / "assets" / "web-template.html"
    try:
        if args.project:
            if any(value is not None for value in (args.slides, args.title, args.css, args.js)):
                parser.error("--project reads --slides, --title, --css and --js from the JSON file")
            project = read_project(args.project)
            args.title, args.slides = project["title"], project["slides"]
            args.css, args.js = project.get("css"), project.get("js")
            args.output = args.output or project["output"]
            if args.output.suffix.lower() not in {".html", ".htm"}:
                raise ValueError(f"{args.output}: the project output must be an HTML file")
        elif args.title is None or not args.slides or args.output is None:
            parser.error("supply --project, or all of --title, --slides and --output")
        parts = list(slide_files(args.slides))
        inputs = [template, *parts, args.css, args.js, args.project]
        output_dir = args.output.resolve().parent
        if any(p and p.resolve() == args.output.resolve() for p in inputs) or any(
                p.is_dir() and p.resolve() == output_dir for p in args.slides):
            raise ValueError("Choose an output outside the slide fragment folder and separate from each input file.")
        sections = "\n".join(read_fragment(part) for part in parts)
        page = assemble(template.read_text(encoding="utf-8"), sections, args.title,
                        args.css.read_text(encoding="utf-8") if args.css else "",
                        args.js.read_text(encoding="utf-8") if args.js else "",
                        check_note_pages=args.project is not None)
        if not args.no_previews:
            page = add_previews(page)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        pending = None
        try:
            with NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.output.parent, delete=False) as output:
                pending = Path(output.name)
                output.write(page)
            pending.replace(args.output)
        finally:
            if pending is not None:
                pending.unlink(missing_ok=True)
    except (OSError, RuntimeError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
