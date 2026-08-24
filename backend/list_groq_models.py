from dotenv import load_dotenv
from groq import Groq

load_dotenv()  # reads GROQ_API_KEY from your .env

client = Groq()

for m in client.models.list().data:
    print(m.id)