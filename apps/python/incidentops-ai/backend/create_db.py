from app.database.db import Base, engine
from app.database import models

Base.metadata.create_all(bind=engine)

print("Database created successfully.")
