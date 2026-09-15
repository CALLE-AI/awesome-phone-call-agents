import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.db import init_db
init_db(reset=True)
print('Seeded data/relay.db from data/seed.json')
