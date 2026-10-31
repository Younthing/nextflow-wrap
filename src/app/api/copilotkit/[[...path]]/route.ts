import { DELETE as deleteCopilot, GET as getCopilot, HEAD as headCopilot, POST as postCopilot } from "@/features/assistant/copilot-route";

export const GET = getCopilot;
export const POST = postCopilot;
export const DELETE = deleteCopilot;
export const HEAD = headCopilot;
