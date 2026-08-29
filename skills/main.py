import speech_recognition as sr
import pyttsx3

from washing_machine import washing_machine
from college import tnea_enquiry
from clinic import clinic_enquiry
from bus import bus_enquiry

engine = pyttsx3.init()
def speak(text):
    print("\n🤖 AI AGENT:")
    print(text)
    engine.say(text)
    engine.runAndWait()

recognizer = sr.Recognizer()

with sr.Microphone() as source:
    print("🎙️ Listening...")
    recognizer.adjust_for_ambient_noise(source)
    audio = recognizer.listen(source)

try:
    request = recognizer.recognize_google(audio).lower()
    print("\n👤 You said:", request)

except sr.UnknownValueError:
    speak("Sorry, I could not understand you.")
    exit()

except sr.RequestError:
    speak("Sorry, speech recognition is not available.")
    exit()
if "washing" in request or "machine" in request:

    result = washing_machine()

elif "college" in request or "tnea" in request or "admission" in request:

    result = tnea_enquiry()
elif "clinic" in request or "doctor" in request or "token" in request:
    result = clinic_enquiry()

elif "bus" in request:

    result = bus_enquiry()
else:

    result = "Sorry, I don't understand your request."
if isinstance(result, dict):
    result = str(result)

speak(result)