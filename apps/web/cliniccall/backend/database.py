from sqlmodel import SQLModel, Session, create_engine

DATABASE_URL = "sqlite:///cliniccall.db"

engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False}
)


def create_tables():
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session