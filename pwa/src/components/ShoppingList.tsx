import { useState, useEffect, useCallback } from "react";
import { fetchShoppingList, saveShoppingList } from "../github";
import type { ShoppingItem } from "../types";
import styles from "./ShoppingList.module.css";

interface Props {
  onToggleSidebar: () => void;
}

export function ShoppingList({ onToggleSidebar }: Props) {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [newQty, setNewQty] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchShoppingList();
      setItems(data);
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
    const item: ShoppingItem = {
      id: Math.random().toString(36).slice(2, 10),
      name,
      quantity: newQty.trim() || undefined,
    };
    await persist([...items, item], `Add shopping item: ${name}`);
    setNewName("");
    setNewQty("");
  }

  async function toggleChecked(id: string) {
    const next = items.map((i) => i.id === id ? { ...i, checked: !i.checked } : i);
    setItems(next);
  }

  async function removeItem(id: string) {
    const next = items.filter((i) => i.id !== id);
    await persist(next, `Remove shopping item`);
  }

  async function removeChecked() {
    const next = items.filter((i) => !i.checked);
    await persist(next, "Remove checked shopping items");
  }

  const checkedCount = items.filter((i) => i.checked).length;

  // Group by category
  const grouped = items.reduce<Record<string, ShoppingItem[]>>((acc, item) => {
    const key = item.category ?? "";
    (acc[key] ??= []).push(item);
    return acc;
  }, {});
  const categories = Object.keys(grouped).sort((a, b) => a === "" ? 1 : b === "" ? -1 : a.localeCompare(b));

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
          placeholder="Qty"
          value={newQty}
          onChange={(e) => setNewQty(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
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
            {grouped[cat].map((item) => (
              <div key={item.id} className={`${styles.item} ${item.checked ? styles.checked : ""}`}>
                <button className={styles.checkbox} onClick={() => toggleChecked(item.id)}>
                  {item.checked ? "✓" : ""}
                </button>
                <span className={styles.itemName}>{item.name}</span>
                {item.quantity && <span className={styles.qty}>{item.quantity}</span>}
                <button className={styles.deleteBtn} onClick={() => removeItem(item.id)}>✕</button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
