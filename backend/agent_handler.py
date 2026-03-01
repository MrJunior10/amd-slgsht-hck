import yaml
import os
from io import BytesIO
from typing import Optional, Dict, Any

# Import your existing helper classes
from study_agents import StudyAgents
from rag_helper import RAGHelper

# --- VOICE IMPORTS (Optional - keep if you plan to use voice features) ---
try:
    from gtts import gTTS
    import speech_recognition as sr
    from openai import OpenAI
except ImportError:
    print("Voice dependencies not found. Voice features will be disabled.")

class StudyAssistantHandler:
    def __init__(self, topic, subject_category, knowledge_level, learning_goal, 
                 time_available, learning_style, model_name="openai/gpt-oss-120b", provider="openrouter", language="English"):
        
        self.topic = topic
        self.subject_category = subject_category
        self.knowledge_level = knowledge_level
        self.learning_goal = learning_goal
        self.time_available = time_available
        self.learning_style = learning_style
        self.language = language
        
        # Initialize the Agents
        self.agents = StudyAgents(
            topic, subject_category, knowledge_level, learning_goal,
            time_available, learning_style, model_name, provider
        )
        
        # Load Prompts
        self.config = self._load_config()
        self.rag_helper = None
        
        # Initialize OpenAI client for Voice (if needed)
        base_url = "https://openrouter.ai/api/v1" if provider == "openrouter" else None
        api_key = os.getenv("OPENROUTER_API_KEY") if provider == "openrouter" else os.getenv("OPENAI_API_KEY")
        
        try:
            self.stt_client = OpenAI(base_url=base_url, api_key=api_key)
        except Exception:
            self.stt_client = None

    def _load_config(self):
        # Ensure prompts.yaml is accessible. You might need to adjust the path depending on where you run main.py
        current_dir = os.path.dirname(os.path.abspath(__file__))
        prompt_path = os.path.join(current_dir, "prompts.yaml")
        
        # Fallback if running from root
        if not os.path.exists(prompt_path):
            prompt_path = "prompts.yaml"
            
        with open(prompt_path, "r") as file:
            return yaml.safe_load(file)

    def _format_prompt(self, prompt_template, **kwargs):
        base_prompt = prompt_template.format(**kwargs)
        if self.language and self.language.lower() != "english":
            return f"{base_prompt}\n\nIMPORTANT: Please respond entirely in {self.language}."
        return base_prompt

    # --- CORE LEARNING FUNCTIONS ---

    def analyze_student(self) -> str:
        """Runs the Student Analyzer Agent and returns the profile text."""
        analyzer = self.agents.student_analyzer_agent()
        analysis_prompt = self._format_prompt(
            self.config["prompts"]["student_analysis"]["base"],
            topic=self.topic,
            subject_category=self.subject_category,
            knowledge_level=self.knowledge_level,
            learning_goal=self.learning_goal,
            time_available=self.time_available,
            learning_style=self.learning_style
        )
        resp = analyzer.run(analysis_prompt, stream=False)
        return resp.content

    def create_roadmap(self, student_analysis: str) -> str:
        """Runs the Roadmap Agent using the analysis and returns the markdown roadmap."""
        roadmap_creator = self.agents.roadmap_creator_agent()
        prompt = self._format_prompt(
            self.config["prompts"]["roadmap_creation"]["base"],
            student_analysis=student_analysis,
            topic=self.topic,
            learning_goal=self.learning_goal,
            time_available=self.time_available,
            knowledge_level=self.knowledge_level
        )
        resp = roadmap_creator.run(prompt, stream=False)
        return resp.content

    def find_resources(self) -> str:
        """Runs the Resource Finder Agent and returns the markdown list of resources."""
        finder = self.agents.resource_finder_agent()
        prompt = self._format_prompt(
            self.config["prompts"]["resource_finding"]["base"],
            topic=self.topic,
            learning_goal=self.learning_goal,
            knowledge_level=self.knowledge_level,
            learning_style=self.learning_style
        )
        resp = finder.run(prompt, stream=False)
        return resp.content

    def generate_quiz(self, difficulty_level="intermediate", focus_areas="general", num_questions=10) -> str:
        """Runs the Quiz Generator Agent."""
        generator = self.agents.quiz_generator_agent()
        prompt = self._format_prompt(
            self.config["prompts"]["quiz_generation"]["base"],
            topic=self.topic,
            difficulty_level=difficulty_level,
            focus_areas=focus_areas,
            num_questions=num_questions
        )
        resp = generator.run(prompt, stream=False)
        return resp.content

    def get_tutoring(self, student_question, context="") -> str:
        """Runs the Tutor Agent."""
        tutor = self.agents.tutor_agent()
        prompt = self._format_prompt(
            self.config["prompts"]["tutoring"]["base"],
            student_question=student_question,
            context=context,
            knowledge_level=self.knowledge_level
        )
        resp = tutor.run(prompt, stream=False)
        return resp.content

    # --- MOCK INTERVIEW FUNCTIONS ---

    def start_mock_interview(self, role="Junior Developer") -> str:
        """Generates the interview question."""
        interviewer_agent = self.agents.tutor_agent()
        prompt = self._format_prompt(
            """
            You are a strict technical interviewer for a {role} position.
            The candidate has been studying: {topic}.
            Generate ONE challenging interview question relevant to this topic.
            It can be conceptual or situational. Do not provide the answer.
            """,
            role=role,
            topic=self.topic
        )
        resp = interviewer_agent.run(prompt, stream=False)
        return resp.content

    def evaluate_interview_answer(self, question, user_answer) -> str:
        """Generates feedback on the user's answer."""
        manager_agent = self.agents.tutor_agent()
        prompt = self._format_prompt(
            """
            You are a Hiring Manager evaluating a candidate's answer.
            Question: "{question}"
            Candidate's Answer: "{user_answer}"
            Grade the answer on Clarity, Accuracy, and Completeness.
            Provide a short "Hiring Decision" and feedback.
            """,
            question=question,
            user_answer=user_answer
        )
        resp = manager_agent.run(prompt, stream=False)
        return resp.content

    # --- RAG (DOCUMENT) FUNCTIONS ---

    def initialize_rag(self, collection_name="study_materials"):
        self.rag_helper = RAGHelper(collection_name=collection_name)

    def add_document_to_rag(self, file_path, file_type="pdf"):
        if not self.rag_helper: self.initialize_rag()
        if file_type == "pdf": return self.rag_helper.load_pdf(file_path)
        elif file_type == "text": return self.rag_helper.load_text(file_path)
        return False

    def query_documents(self, question, k=4) -> str:
        if not self.rag_helper: return "No documents uploaded."
        relevant_docs = self.rag_helper.query(question, k=k)
        if not relevant_docs: return "No relevant info found in documents."
        
        context = "\n\n".join(relevant_docs)
        rag_tutor = self.agents.rag_tutor_agent()
        prompt = self._format_prompt(
            self.config["prompts"]["rag_query"]["base"],
            question=question,
            context=context
        )
        resp = rag_tutor.run(prompt, stream=False)
        return resp.content

    def get_document_count(self):
        return self.rag_helper.get_document_count() if self.rag_helper else 0

    def clear_documents(self):
        return self.rag_helper.clear_database() if self.rag_helper else False

    # --- VOICE HELPERS (Optional) ---
    def transcribe_audio(self, audio_bytes):
        try:
            r = sr.Recognizer()
            audio_file = BytesIO(audio_bytes)
            with sr.AudioFile(audio_file) as source:
                audio_data = r.record(source)
            text = r.recognize_google(audio_data)
            return text
        except Exception as e:
            return f"Error: {str(e)}"

    def text_to_speech(self, text):
        try:
            tts = gTTS(text=text, lang="en", slow=False)
            audio_fp = BytesIO()
            tts.write_to_fp(audio_fp)
            return audio_fp
        except Exception as e:
            print(f"TTS Error: {e}")
            return None