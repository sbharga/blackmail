import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(
    base_url="https://api.tokenfactory.nebius.com/v1/",
    api_key=os.environ.get("NEBIUS_API_KEY")
)

# print(client.models.list())

response = client.chat.completions.create(
    model="deepseek-ai/DeepSeek-V4-Flash-0731",
    messages=[
        {
            "role": "system",
            "content": """You are a helpful assistant"""
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": """What is the square root of -1"""
                }
            ]
        }
    ]
)

print(response.to_json())
