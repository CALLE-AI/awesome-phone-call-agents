import sys

# `dial` is routed before argparse sees anything, because the main parser is flat: it
# takes options and no positionals, and teaching it a subcommand would change how every
# documented invocation parses. One word, checked once, keeps the two shapes apart.
if len(sys.argv) > 1 and sys.argv[1] == "dial":
    from .dial import main as dial_main

    raise SystemExit(dial_main(sys.argv[2:]))

from .cli import main

raise SystemExit(main())
