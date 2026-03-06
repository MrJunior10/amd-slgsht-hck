import os
import shutil
from typing import Optional, List
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# --- CUSTOM MODULES ---
from agent_handler import StudyAssistantHandler
from database import DatabaseManager

import json
import firebase_admin
from firebase_admin import credentials

# Get the JSON string from Render's environment variables
firebase_json = os.getenv("FIREBASE_CONFIG_JSON")

if firebase_json:
    # Parse the string back into a dictionary
    cred_dict = json.loads(firebase_json)
    cred = credentials.Certificate(cred_dict)
    firebase_admin.initialize_app(cred)
else:
    # Fallback for local testing
    cred = credentials.Certificate("firebase_credentials.json")
    firebase_admin.initialize_app(cred)

load_dotenv()

app = FastAPI(title="Agentic Study.ai API")

# Initialize Firebase Database
db_manager = DatabaseManager()

# --- CORS SETUP ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- GLOBAL STATE ---
# Used for temporary active session speed (Quiz/RAG context)
active_session = {
    "handler": None,
}

def get_or_create_handler(topic="General"):
    """Auto-rehydrates the handler if the server restarted but the user is still on the dashboard."""
    if not active_session["handler"]:
        print(f"--> Auto-initializing session handler for topic: {topic}")
        active_session["handler"] = StudyAssistantHandler(
            topic=topic,
            subject_category="General",
            knowledge_level="Intermediate",
            learning_goal="Mastery",
            time_available="4 Weeks",
            learning_style="Visual",
            language="English"
        )
    return active_session["handler"]

# --- DATA MODELS ---
class InitRequest(BaseModel):
    user_id: str      
    topic: str
    knowledge_level: str
    time_available: str
    # Added defaults below so FastAPI doesn't throw a 422 error if JS omits them
    subject_category: str = "General"
    learning_goal: str = "Mastery"
    learning_style: str = "Visual"
    language: str = "English"

class ChatRequest(BaseModel):
    user_id: str      
    message: str
    context: str = ""

class QuizRequest(BaseModel):
    user_id: str       # Match JS Payload
    topic: str         # Match JS Payload
    difficulty: str = "intermediate"
    num_questions: int = 5

class InterviewRequest(BaseModel):
    role: str = "Junior Developer"

class InterviewAnswerRequest(BaseModel):
    question: str
    answer: str

# --- ENDPOINTS ---

@app.get("/")
def health_check():
    return {"status": "online", "db": "firebase_connected"}

@app.post("/api/start")
def start_learning_plan(req: InitRequest):
    """Generates a plan and saves it to Firebase."""
    try:
        # 1. Initialize Handler
        handler = StudyAssistantHandler(
            topic=req.topic,
            subject_category=req.subject_category,
            knowledge_level=req.knowledge_level,
            learning_goal=req.learning_goal,
            time_available=req.time_available,
            learning_style=req.learning_style,
            language=req.language
        )
        active_session["handler"] = handler
        
        # 2. Generate Content
        print(f"--> Generating Plan for {req.user_id}...")
        analysis = handler.analyze_student()
        roadmap = handler.create_roadmap(analysis)
        resources = handler.find_resources()
        
        # 3. SAVE TO BACKEND FIREBASE (Persistent Memory)
        # Note: Frontend JS is also saving to its Vault, ensuring sync.
        db_manager.save_plan(req.user_id, roadmap, resources, req.topic)
        
        # Must return "roadmap" and "resources" exactly for JS to render
        return {
            "status": "success",
            "analysis": analysis,
            "roadmap": roadmap,
            "resources": resources
        }
    except Exception as e:
        print(f"ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/load/{user_id}")
def load_existing_plan(user_id: str):
    """Called when user refreshes the page to restore state."""
    print(f"--> Loading plan for {user_id}...")
    data = db_manager.load_plan(user_id)
    
    if data:
        topic = data.get("topic", "General")
        get_or_create_handler(topic)

        return {
            "status": "found",
            "roadmap": data.get("roadmap"),
            "resources": data.get("resources"),
            "topic": topic
        }
    return {"status": "not_found"}

@app.post("/api/chat")
def chat_with_tutor(req: ChatRequest):
    handler = get_or_create_handler()
    
    response = handler.get_tutoring(req.message, req.context)
    
    # Save chat history to Firebase
    db_manager.save_chat(req.user_id, req.message, "user")
    db_manager.save_chat(req.user_id, response, "ai")
    
    return {"reply": response}

@app.post("/api/quiz/generate") # UPDATED ROUTE TO MATCH JAVASCRIPT
def generate_quiz(req: QuizRequest):
    handler = get_or_create_handler(req.topic)
    
    # NOTE: Ensure your handler.generate_quiz() returns a list of dicts 
    # matching the JS format: [{question: "", options: [], correct_index: 0, explanation: ""}]
    quiz_content = handler.generate_quiz(
        difficulty_level=req.difficulty, 
        num_questions=req.num_questions
    )
    return {"quiz": quiz_content}

@app.post("/api/interview/start")
def start_interview(req: InterviewRequest):
    handler = get_or_create_handler()
    question = handler.start_mock_interview(role=req.role)
    return {"question": question}

@app.post("/api/interview/evaluate")
def evaluate_interview(req: InterviewAnswerRequest):
    handler = get_or_create_handler()
    feedback = handler.evaluate_interview_answer(req.question, req.answer)
    return {"feedback": feedback}

@app.post("/api/rag/upload")
async def upload_document(
    file: UploadFile = File(...),
    user_id: str = Form(...) # Added to catch the userId from the FormData
):
    handler = get_or_create_handler()
    
    # Save file temporarily
    os.makedirs("temp_uploads", exist_ok=True)
    file_path = f"temp_uploads/{file.filename}"
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # Process with RAG Helper
    handler.initialize_rag()
    success = handler.add_document_to_rag(file_path, file_type="pdf")
    
    # Cleanup
    os.remove(file_path)
    
    if success:
        return {"status": "success", "filename": file.filename}
    else:
        raise HTTPException(status_code=500, detail="Failed to process document")

@app.post("/api/rag/query")
def query_documents(req: ChatRequest):
    handler = get_or_create_handler()
    response = handler.query_documents(req.message)
    return {"reply": response}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)