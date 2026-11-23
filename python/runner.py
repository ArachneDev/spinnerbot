"""Runs one command for the bot. Reads JSON from stdin and writes one JSON reply to stdout.

Commands never need to touch this. Anything they print goes to the bot's log.
"""

import asyncio
import importlib
import inspect
import json
import os
import sys
import traceback
from pathlib import Path


def main() -> int:
    name, commands_root = sys.argv[1], sys.argv[2]

    # Keep stdout for the reply. print(), and anything a library writes, goes to stderr instead.
    reply_stream = os.fdopen(os.dup(1), "w", encoding="utf-8")
    os.dup2(2, 1)

    # -I leaves this script's folder off the path, so add it for `from scrimbot import ...`.
    sys.path[:0] = [commands_root, str(Path(__file__).parent)]
    from scrimbot import UserError

    try:
        data = json.load(sys.stdin)
        module = importlib.import_module(f"commands.{name}")
        result = module.run(data)
        if inspect.isawaitable(result):
            result = asyncio.run(_wait(result))
        reply = json.dumps({"ok": True, "result": result})
    except UserError as error:
        reply = json.dumps({"ok": False, "error": str(error)})
    except (Exception, SystemExit):
        traceback.print_exc()
        return 1

    reply_stream.write(reply)
    reply_stream.close()
    return 0


async def _wait(awaitable):
    return await awaitable


if __name__ == "__main__":
    sys.exit(main())
