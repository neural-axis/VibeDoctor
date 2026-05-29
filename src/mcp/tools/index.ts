import { explainFindingTool } from "./explainFinding";
import { fixSafeTool } from "./fixSafe";
import { getAgentPlanTool } from "./getAgentPlan";
import { getReportTool } from "./getReport";
import { scanChangedTool } from "./scanChanged";
import { scanFullTool } from "./scanFull";
import { verifyTool } from "./verify";

export const mcpTools = [
  scanChangedTool,
  scanFullTool,
  fixSafeTool,
  getReportTool,
  getAgentPlanTool,
  explainFindingTool,
  verifyTool
];
