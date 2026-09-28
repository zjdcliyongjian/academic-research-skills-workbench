import { taskExamples } from "./taskGuidance";

export function TaskHint({ skill, value, onFill }: { skill: string; value: string; onFill: (value: string) => void }) {
  const example = taskExamples[skill];
  if (!example) return null;
  return <details className="task-hint"><summary>不知道怎么填？查看本环节示例</summary><p>{example}</p><button type="button" className="button secondary small" onClick={() => {
    if (!value.trim() || window.confirm("填入示例会替换当前输入，是否继续？")) onFill(example);
  }}>填入示例（可编辑）</button><p className="micro-note">示例不会自动提交；请补充真实条件后再运行。</p></details>;
}
