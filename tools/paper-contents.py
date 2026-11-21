"""Create the Web reader's contents.json from a reviewed HTML article."""

import argparse
import json
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from tempfile import NamedTemporaryFile


class PaperHeadings(HTMLParser):
    """Capture h2 text and the section anchors that the reader can actually open."""

    def __init__(self):
        super().__init__()
        self.containers = []
        self.ids = Counter()
        self.heading = None
        self.text = []
        self.contents = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        anchor = attrs.get("id", "")
        classes = set((attrs.get("class") or "").split())
        if anchor:
            self.ids[anchor] += 1
        if tag in {"section", "div"}:
            section = tag == "section" or bool(classes & {"ltx_section", "ltx_abstract", "ltx_bibliography", "ltx_appendix"})
            self.containers.append((tag, section, anchor, "ltx_appendix" in classes))
        if tag == "h2":
            if self.heading is not None:
                raise ValueError(f"line {self.getpos()[0]}: unclosed h2 before this heading")
            section = next((entry for entry in reversed(self.containers) if entry[1]), None)
            self.heading = (anchor or (section[2] if section else ""), self.getpos()[0],
                            "ltx_title_appendix" in classes or bool(section and section[3]))
            self.text = []
        elif tag == "br" and self.heading is not None:
            self.text.append(" ")

    def handle_data(self, data):
        if self.heading is not None:
            self.text.append(data)

    def handle_endtag(self, tag):
        if tag == "h2" and self.heading is not None:
            anchor, line, appendix = self.heading
            title = " ".join("".join(self.text).split())
            if not anchor or any(char.isspace() for char in anchor):
                raise ValueError(f"line {line}: give h2 {title!r} or its containing section a stable id")
            if not title:
                raise ValueError(f"line {line}: heading #{anchor} has no readable title")
            entry = {"id": anchor, "title": title}
            if appendix:
                entry["appendix"] = True
            self.contents.append(entry)
            self.heading = None
        if tag in {"section", "div"}:
            for index in range(len(self.containers) - 1, -1, -1):
                if self.containers[index][0] == tag:
                    del self.containers[index:]
                    break

    def result(self):
        if self.heading is not None:
            raise ValueError(f"line {self.heading[1]}: unclosed h2")
        if not self.contents:
            raise ValueError("no h2 headings found; supply params.contents for a custom outline")
        seen = set()
        for entry in self.contents:
            anchor = entry["id"]
            if anchor in seen or self.ids[anchor] != 1:
                raise ValueError(f"ambiguous heading #{anchor}; give every contents link a unique HTML id")
            seen.add(anchor)
        return self.contents


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("body", type=Path, help="assets/papers/<slug>/body.html")
    args = cli.parse_args()
    target = args.body.with_name("contents.json")
    try:
        parser = PaperHeadings()
        parser.feed(args.body.read_text(encoding="utf-8"))
        parser.close()
        contents = parser.result()
        output = json.dumps(contents, ensure_ascii=False, indent=2) + "\n"
        if not target.exists() or target.read_text(encoding="utf-8") != output:
            with NamedTemporaryFile(mode="w", encoding="utf-8", dir=target.parent, delete=False) as draft:
                draft.write(output)
            Path(draft.name).replace(target)
    except (ValueError, OSError) as exc:
        cli.exit(1, f"{args.body}: {exc}\n")
    print(f"{target}: {len(contents)} headings")


if __name__ == "__main__":
    main()
