"""Assemble index.html: pre-paint theme stamp + styles + body + inlined data + app.

The Artifact CSP blocks fetch/XHR entirely, so the data cannot be loaded at runtime --
it has to ship inside the page.
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = os.path.join(ROOT, "src")

def read(p):
    with open(os.path.join(S, p)) as f: return f.read()

# Applied before the stylesheet so an explicit choice never flashes the other theme.
PREPAINT = """<script>
(function(){try{var m=localStorage.getItem("aos-theme");
if(m&&m!=="auto")document.documentElement.setAttribute("data-theme",m);}catch(e){}})();
</script>
"""

def main():
    with open(os.path.join(ROOT, "data", "phenology.json")) as f:
        data = f.read()
    html = (PREPAINT + read("page_head.html") + read("page_body.html")
            + "\n<script>window.PHENOLOGY=" + data + ";</script>\n"
            + "<script>\n" + read("app.js") + "\n</script>\n")
    out = os.path.join(ROOT, "index.html")
    with open(out, "w") as f: f.write(html)
    print(f"wrote {out}  {os.path.getsize(out)/1024:.0f} KB")

    # Regenerating the page drops the standalone-document wrapper and the catalog
    # breadcrumb unless they are reapplied here. Both tools are idempotent.
    # Run --unwrap on index.html before republishing it as an Artifact, then rebuild.
    tools = os.path.join(ROOT, "..", "..", "catalog", "tools")
    for tool in ("wrap_for_pages.py", "add_catalog_link.py"):
        t = os.path.join(tools, tool)
        if os.path.exists(t):
            subprocess.run([sys.executable, t, out], check=True)
        else:
            print(f"  (skipped {tool} -- catalog tools not found)")

if __name__ == "__main__":
    main()
