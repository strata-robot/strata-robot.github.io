"""Make a claude.ai artifact preview of index.html: keep only the <!--HEAD--> and <!--BODY--> parts
(the artifact host adds its own document skeleton). Usage: python3 tools/make_preview.py OUT.html"""
import re, sys, os
src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "index.html")).read()
head = re.search(r"<!--HEAD-->(.*?)<!--/HEAD-->", src, re.S).group(1)
body = re.search(r"<!--BODY-->(.*?)<!--/BODY-->", src, re.S).group(1)
open(sys.argv[1], "w").write(head.strip() + "\n" + body.strip() + "\n")
