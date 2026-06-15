import { streamText } from "ai"

async function main() {
  console.log("[v0] Starting AI Gateway verification with openai/gpt-5.5...\n")

  const result = streamText({
    model: "openai/gpt-5.5",
    prompt: "Write a one-sentence confirmation that the Vercel AI Gateway is working.",
  })

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk)
  }

  console.log("\n\n[v0] AI Gateway is working correctly.")
}

main().catch((err) => {
  console.error("[v0] AI Gateway verification failed:", err)
  process.exit(1)
})
