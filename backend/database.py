from sqlalchemy import create_engine, Column, String, Text, DateTime
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import json

DATABASE_URL = "sqlite:///./agent.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class TaskModel(Base):
    __tablename__ = "tasks"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    task = Column(Text, nullable=False)
    status = Column(String, default="pending")
    steps = Column(Text, default="[]")
    result = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class UserModel(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=True)
    picture = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


Base.metadata.create_all(bind=engine)


def create_task(task_id: str, user_id: str, task: str):
    db = SessionLocal()
    db_task = TaskModel(id=task_id, user_id=user_id, task=task)
    db.add(db_task)
    db.commit()
    db.close()


def update_task(task_id: str, status: str = None, steps: list = None, result: dict = None):
    db = SessionLocal()
    task = db.query(TaskModel).filter(TaskModel.id == task_id).first()

    if task:
        if status is not None:
            task.status = status
        if steps is not None:
            task.steps = json.dumps(steps)
        if result is not None:
            task.result = json.dumps(result)

        db.commit()

    db.close()


def get_task(task_id: str, user_id: str):
    db = SessionLocal()
    task = db.query(TaskModel).filter(
        TaskModel.id == task_id,
        TaskModel.user_id == user_id
    ).first()
    db.close()

    if not task:
        return None

    return {
        "id": task.id,
        "user_id": task.user_id,
        "task": task.task,
        "status": task.status,
        "steps": json.loads(task.steps),
        "result": json.loads(task.result) if task.result else None,
        "created_at": task.created_at.isoformat()
    }


def get_all_tasks(user_id: str):
    db = SessionLocal()
    tasks = db.query(TaskModel).filter(
        TaskModel.user_id == user_id
    ).order_by(TaskModel.created_at.desc()).limit(50).all()
    db.close()

    return [{
        "id": t.id,
        "user_id": t.user_id,
        "task": t.task,
        "status": t.status,
        "steps": json.loads(t.steps),
        "result": json.loads(t.result) if t.result else None,
        "created_at": t.created_at.isoformat()
    } for t in tasks]


def get_or_create_user(user_id: str, email: str, name: str, picture: str):
    db = SessionLocal()
    user = db.query(UserModel).filter(UserModel.email == email).first()

    if not user:
        user = UserModel(id=user_id, email=email, name=name, picture=picture)
        db.add(user)
        db.commit()
        db.refresh(user)

    db.close()

    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "picture": user.picture
    }


def get_user_by_email(email: str):
    db = SessionLocal()
    user = db.query(UserModel).filter(UserModel.email == email).first()
    db.close()

    if not user:
        return None

    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "picture": user.picture
    }