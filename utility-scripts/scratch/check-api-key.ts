import 'dotenv/config';

console.log("=== CHECKING GEMINI API KEY ACCESS ===");
const apiKey = process.env.GEMINI_API_KEY;

if (apiKey) {
  console.log("Status: 🟢 GEMINI_API_KEY IS AVAILABLE!");
  console.log(`Length: ${apiKey.length} characters`);
  console.log(`First 4 characters: ${apiKey.slice(0, 4)}...`);
  console.log(`Last 4 characters: ...${apiKey.slice(-4)}`);
} else {
  console.log("Status: 🔴 GEMINI_API_KEY IS NOT AVAILABLE.");
  console.log("Please check your .env file or system environment variables.");
}
