import { useState } from "react";
import { createSkill, deleteSkill, toggleSkill, useSkills } from "../ai/skills";

export default function SkillsPanel() {
  const skills = useSkills();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [rules, setRules] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const row = (s: (typeof skills)[number]) => (
    <div className="skill" key={s.id}>
      <div className="n">
        {s.name}
        <small>{s.summary}</small>
      </div>
      {s.source === "mine" && (
        <span className="x" title="Delete this skill" onClick={() => deleteSkill(s.id)}>
          Delete
        </span>
      )}
      <div className={`sw ${s.enabled ? "on" : ""}`} onClick={() => toggleSkill(s.id)} role="switch" aria-checked={s.enabled} />
    </div>
  );

  const save = async () => {
    const result = await createSkill(name, rules);
    setNote(result);
    if (!result) {
      setName("");
      setRules("");
      setAdding(false);
    }
  };

  const mine = skills.filter((s) => s.source === "mine");
  return (
    <div className="skills">
      <div className="h">Shipped with Duet</div>
      {skills.filter((s) => s.source === "shipped").map(row)}
      <div className="h">Mine</div>
      {mine.length === 0 && !adding && <div className="empty">Rules of your own, saved for every project.</div>}
      {mine.map(row)}
      {adding ? (
        <div className="newskill">
          <input value={name} placeholder="Name, like My brand rules" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <textarea
            value={rules}
            rows={6}
            placeholder={"One rule per line, like:\n- Buttons are always pill shaped\n- Use #5c0700 for warnings"}
            onChange={(e) => setRules(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          {note && <div className="pop-note">{note}</div>}
          <div className="row2">
            <button className="mini primary" onClick={save}>
              Save skill
            </button>
            <button className="mini" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="add" onClick={() => setAdding(true)}>
          + New skill
        </div>
      )}
      <div className="hint">Turned-on skills are given to Duet every time you chat.</div>
    </div>
  );
}
