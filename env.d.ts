/* eslint-disable */
// Hand-maintained for the workshop. Regenerate with:
//   wrangler types env.d.ts --include-runtime false
declare namespace Cloudflare {
	interface GlobalProps {
		mainModule: typeof import("./src/server");
		durableNamespaces: "ReviewAgent" | "ReviewMCP";
	}
	interface Env {
		AI: Ai;
		ReviewAgent: DurableObjectNamespace<import("./src/server").ReviewAgent>;
		ReviewMCP: DurableObjectNamespace<import("./src/mcp").ReviewMCP>;
		REVIEW_WORKFLOW: Workflow<import("./src/workflows/review").ReviewParams>;
		// Optional. Set via `wrangler secret put GITHUB_TOKEN` to raise the
		// GitHub API rate limit from 60 to 5000 requests/hour.
		GITHUB_TOKEN?: string;
		// Optional. Set in wrangler.jsonc as a var to enable AI Gateway
		// logging and caching for Workers AI requests.
		AI_GATEWAY_ID?: string;
	}
}
interface Env extends Cloudflare.Env {}
