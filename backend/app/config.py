import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://survey:survey123@db:3306/survey_db"
    )
    MEDIA_ROOT: str = os.getenv("MEDIA_ROOT", "/app/media")

settings = Settings()