import { useState, useEffect, useCallback } from "react";
import { fetchShoppingList, saveShoppingList } from "../github";
import type { ShoppingItem } from "../types";
import styles from "./ShoppingList.module.css";

interface Props {
  onToggleSidebar: () => void;
}

const UNIT_GROUPS: { label: string; units: string[] }[] = [
  { label: "Weight", units: ["g", "kg", "oz", "lb"] },
  { label: "Volume", units: ["ml", "L", "tsp", "tbsp", "cup", "fl oz", "pt"] },
  { label: "Count", units: ["each", "dozen", "pack", "bunch", "can", "jar", "box", "bag", "bottle"] },
];

const ALL_UNITS = UNIT_GROUPS.flatMap((g) => g.units);
const OTHER_VALUE = "__other__";

function formatQty(item: ShoppingItem): string | null {
  if (item.qty == null && !item.unit) return null;
  const q = item.qty != null ? String(item.qty) : "";
  const u = item.unit ?? "";
  return [q, u].filter(Boolean).join(" ") || null;
}

/** Controlled unit selector: select + optional custom text input */
function UnitSelector({
  unit, customUnit, onUnitChange, onCustomChange, onKeyDown, selectClass, inputClass,
}: {
  unit: string;
  customUnit: string;
  onUnitChange: (v: string) => void;
  onCustomChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  selectClass: string;
  inputClass: string;
}) {
  const isCustom = unit === OTHER_VALUE;
  return (
    <>
      <select className={selectClass} value={unit} onChange={(e) => { onUnitChange(e.target.value); onCustomChange(""); }} onKeyDown={onKeyDown}>
        <option value="">Unit</option>
        {UNIT_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.units.map((u) => <option key={u} value={u}>{u}</option>)}
          </optgroup>
        ))}
        <option value={OTHER_VALUE}>Other…</option>
      </select>
      {isCustom && (
        <input
          className={inputClass}
          placeholder="Unit name"
          value={customUnit}
          onChange={(e) => onCustomChange(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
      )}
    </>
  );
}

export function ShoppingList({ onToggleSidebar }: Props) {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Add form state
  const [newName, setNewName] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [newCustomUnit, setNewCustomUnit] = useState("");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editCustomUnit, setEditCustomUnit] = useState("");

  const effectiveAddUnit = newUnit === OTHER_VALUE ? newCustomUnit.trim() : newUnit;
  const effectiveEditUnit = editUnit === OTHER_VALUE ? editCustomUnit.trim() : editUnit;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchShoppingList());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function persist(next: ShoppingItem[], message?: string) {
    setSaving(true);
    try {
      await saveShoppingList(next, message);
      setItems(next);
    } finally {
      setSaving(false);
    }
  }

  async function addItem() {
    const name = newName.trim();
    if (!name) return;
    const qtyNum = newQty.trim() ? parseFloat(newQty) : undefined;
    const item: ShoppingItem = {
      id: Math.random().toString(36).slice(2, 10),
      name,
      qty: qtyNum != null && !isNaN(qtyNum) ? qtyNum : undefined,
      unit: effectiveAddUnit || undefined,
    };
    await persist([...items, item], `Add shopping item: ${name}`);
    setNewName("");
    setNewQty("");
    setNewUnit("");
    setNewCustomUnit("");
  }

  function startEdit(item: ShoppingItem) {
    setEditingId(item.id);
    setEditName(item.name);
    setEditQty(item.qty != null ? String(item.qty) : "");
    const knownUnit = item.unit && ALL_UNITS.includes(item.unit) ? item.unit : item.unit ? OTHER_VALUE : "";
    setEditUnit(knownUnit);
    setEditCustomUnit(knownUnit === OTHER_VALUE ? (item.unit ?? "") : "");
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    const name = editName.trim();
    if (!name) return;
    const qtyNum = editQty.trim() ? parseFloat(editQty) : undefined;
    const next = items.map((i) =>
      i.id === id
        ? {
            ...i,
            name,
            qty: qtyNum != null && !isNaN(qtyNum) ? qtyNum : undefined,
            unit: effectiveEditUnit || undefined,
          }
        : i
    );
    await persist(next, `Update shopping item: ${name}`);
    setEditingId(null);
  }

  async function toggleChecked(id: string) {
    const next = items.map((i) => i.id === id ? { ...i, checked: !i.checked } : i);
    setItems(next);
  }

  async function removeItem(id: string) {
    await persist(items.filter((i) => i.id !== id), "Remove shopping item");
  }

  async function removeChecked() {
    await persist(items.filter((i) => !i.checked), "Remove checked shopping items");
  }

  const checkedCount = items.filter((i) => i.checked).length;

  const grouped = items.reduce<Record<string, ShoppingItem[]>>((acc, item) => {
    const key = item.category ?? "";
    (acc[key] ??= []).push(item);
    return acc;
  }, {});
  const categories = Object.keys(grouped).sort((a, b) =>
    a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <button className={styles.hamburger} onClick={onToggleSidebar}>☰</button>
          <span className={styles.title}>Shopping List</span>
        </div>
        <div className={styles.actions}>
          {checkedCount > 0 && (
            <button className={styles.clearBtn} onClick={removeChecked} disabled={saving}>
              Remove checked ({checkedCount})
            </button>
          )}
          <button className={styles.iconBtn} onClick={load} title="Refresh">↻</button>
        </div>
      </div>

      <div className={styles.addRow}>
        <input
          className={styles.nameInput}
          placeholder="Add item…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
        />
        <input
          className={styles.qtyInput}
          type="number"
          placeholder="Qty"
          min={0}
          value={newQty}
          onChange={(e) => setNewQty(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
        />
        <UnitSelector
          unit={newUnit}
          customUnit={newCustomUnit}
          onUnitChange={setNewUnit}
          onCustomChange={setNewCustomUnit}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
          selectClass={styles.unitSelect}
          inputClass={styles.customUnitInput}
        />
        <button className={styles.addBtn} onClick={addItem} disabled={!newName.trim() || saving}>
          Add
        </button>
      </div>

      <div className={styles.list}>
        {loading && <p className={styles.empty}>Loading…</p>}
        {!loading && items.length === 0 && <p className={styles.empty}>No items yet.</p>}
        {!loading && categories.map((cat) => (
          <div key={cat} className={styles.group}>
            {cat && <div className={styles.groupLabel}>{cat}</div>}
            {grouped[cat].map((item) => {
              if (editingId === item.id) {
                return (
                  <div key={item.id} className={styles.itemEditing}>
                    <input
                      className={styles.editNameInput}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(item.id); if (e.key === "Escape") cancelEdit(); }}
                      autoFocus
                    />
                    <input
                      className={styles.editQtyInput}
                      type="number"
                      placeholder="Qty"
                      min={0}
                      value={editQty}
                      onChange={(e) => setEditQty(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(item.id); if (e.key === "Escape") cancelEdit(); }}
                    />
                    <UnitSelector
                      unit={editUnit}
                      customUnit={editCustomUnit}
                      onUnitChange={setEditUnit}
                      onCustomChange={setEditCustomUnit}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(item.id); if (e.key === "Escape") cancelEdit(); }}
                      selectClass={styles.unitSelect}
                      inputClass={styles.customUnitInput}
                    />
                    <button className={styles.saveBtn} onClick={() => saveEdit(item.id)} disabled={!editName.trim() || saving}>✓</button>
                    <button className={styles.cancelBtn} onClick={cancelEdit}>✕</button>
                  </div>
                );
              }

              const qtyLabel = formatQty(item);
              return (
                <div key={item.id} className={`${styles.item} ${item.checked ? styles.checked : ""}`}>
                  <button className={styles.checkbox} onClick={() => toggleChecked(item.id)}>
                    {item.checked ? "✓" : ""}
                  </button>
                  <span className={styles.itemName}>{item.name}</span>
                  {qtyLabel && <span className={styles.qtyBadge}>{qtyLabel}</span>}
                  <button className={styles.editBtn} onClick={() => startEdit(item)} title="Edit">✎</button>
                  <button className={styles.deleteBtn} onClick={() => removeItem(item.id)}>✕</button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
