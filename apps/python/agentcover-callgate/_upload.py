"""Upload the AgentCover CallGate app to the fork via the GitHub contents API.

No local clone needed — each file is base64'd and PUT to
TheDub-lab/awesome-phone-call-agents on branch main. Then the apps/README.md
is updated to append the index line.
"""
import base64
import json
import os
import subprocess
import sys

TOKEN = os.environ["GH_TOKEN"]
REPO = "TheDub-lab/awesome-phone-call-agents"
BRANCH = "main"
SRC = r"C:/Users/michael/agentcover/apps/python/agentcover-callgate"

API = "https://api.github.com/repos/" + REPO + "/contents/"

def gh_api(method, path, body=None, accept="application/vnd.github+json"):
    cmd = ["gh", "api", "--method", method, path]
    if body is not None:
        cmd += ["-f", "message=" + body.get("message", "update")]
        if "content" in body:
            cmd += ["-f", "content=" + body["content"]]
        if "sha" in body:
            cmd += ["-f", "sha=" + body["sha"]]
        cmd += ["-f", "branch=" + BRANCH]
    # pass token via env
    env = dict(os.environ)
    r = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if r.returncode != 0:
        raise RuntimeError(f"{method} {path} failed: {r.stderr}\n{r.stdout}")
    return r.stdout

def upload(local_rel):
    local = os.path.join(SRC, local_rel)
    with open(local, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    path = "apps/python/agentcover-callgate/" + local_rel
    body = {
        "message": f"Add AgentCover CallGate: {local_rel}",
        "content": b64,
    }
    try:
        gh_api("PUT", API + path, body)
        print("OK  ", path)
    except RuntimeError as e:
        # already exists? try update with sha
        if "already exist" in str(e) or "sha" in str(e):
            sha = json.loads(gh_api("GET", API + path)).get("sha")
            body["sha"] = sha
            gh_api("PUT", API + path, body)
            print("UPD  ", path)
        else:
            raise

# 1) upload all source files (exclude demo_build, __pycache__, PR_DRAFT.md)
skip_dirs = ("demo_build", "__pycache__")
files = []
for root, dirs, names in os.walk(SRC):
    dirs[:] = [d for d in dirs if d not in skip_dirs]
    for n in names:
        if n == "PR_DRAFT.md":
            continue
        full = os.path.join(root, n)
        rel = os.path.relpath(full, SRC).replace("\\", "/")
        files.append(rel)

for rel in sorted(files):
    upload(rel)

# 2) update apps/README.md with the index line
readme = gh_api("GET", API + "apps/README.md")
rd = json.loads(readme)
current = base64.b64decode(rd["content"]).decode("utf-8")
new_line = ("| [`agentcover-callgate`](python/agentcover-callgate/) | Python | "
            "Bounded-autonomy gateway that wraps every CALL-E phone call in the "
            "safety_protocol enforcement layer: scope allowlist, budget, kill "
            "switch, immutable audit, and claims-ready insurance evidence. |")
if "agentcover-callgate" not in current:
    updated = current.rstrip() + "\n" + new_line + "\n"
    b64 = base64.b64encode(updated.encode()).decode()
    gh_api("PUT", API + "apps/README.md", {
        "message": "docs(apps): add agentcover-callgate to index",
        "content": b64,
        "sha": rd["sha"],
    })
    print("OK   apps/README.md (index line added)")
else:
    print("SKIP apps/README.md (line already present)")

print("DONE")
