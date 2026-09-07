"""Server entry point.

The portable Python in use is an `embeddable` distribution: its sys.path is
frozen by a ._pth file and ignores the current directory. So the ringback
package is made findable explicitly before the import.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ringback.serveur import principal  # noqa: E402

if __name__ == "__main__":
    principal()
