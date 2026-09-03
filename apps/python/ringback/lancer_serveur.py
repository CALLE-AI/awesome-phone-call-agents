"""Point d'entrée du serveur.

Le Python portable utilisé est une distribution « embarquée » : son
sys.path est figé par un fichier ._pth et ignore le dossier courant.
On rend donc le paquet ringback trouvable explicitement avant l'import.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ringback.serveur import principal  # noqa: E402

if __name__ == "__main__":
    principal()
