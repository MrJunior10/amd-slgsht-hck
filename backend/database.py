import firebase_admin
from firebase_admin import credentials, firestore
import os
import datetime

# 1. Initialize Firebase
# Ensure 'firebase_credentials.json' is in your backend folder!
if not firebase_admin._apps:
    try:
        cred = credentials.Certificate("firebase_credentials.json")
        firebase_admin.initialize_app(cred)
        print("✅ Firebase initialized successfully.")
    except Exception as e:
        print(f"❌ Firebase Error: {e}")
        print("   (Did you forget to put the json file in the backend folder?)")

db = firestore.client()

class DatabaseManager:
    def __init__(self):
        self.users_ref = db.collection("users")

    def save_plan(self, user_id, roadmap_data, resources_data, topic):
        """Saves the generated plan to Firestore."""
        doc_ref = self.users_ref.document(user_id)
        doc_ref.set({
            "topic": topic,
            "roadmap": roadmap_data,
            "resources": resources_data,
            "created_at": firestore.SERVER_TIMESTAMP,
            "last_active": firestore.SERVER_TIMESTAMP
        }, merge=True)
        print(f"💾 Plan saved for user: {user_id}")

    def load_plan(self, user_id):
        """Retrieves the plan so the user can pick up where they left off."""
        doc = self.users_ref.document(user_id).get()
        if doc.exists:
            return doc.to_dict()
        return None

    def save_chat(self, user_id, message, sender):
        """Logs chat history."""
        # We store chats in a sub-collection for scalability
        self.users_ref.document(user_id).collection("chat_history").add({
            "text": message,
            "sender": sender, # "user" or "ai"
            "timestamp": firestore.SERVER_TIMESTAMP
        })

    def save_quiz_result(self, user_id, score, total):
        """Updates the user's quiz statistics."""
        self.users_ref.document(user_id).update({
            "last_quiz_score": score,
            "last_quiz_total": total,
            "last_quiz_date": firestore.SERVER_TIMESTAMP
        })