"use strict";
(async () => {
  const grid = document.getElementById("grid");
  const { permission, sources } = await window.picker.sources();
  if (permission !== "granted") document.getElementById("warn").hidden = false;
  grid.textContent = "";
  const card = (label, tag, thumb, onClick) => {
    const b = document.createElement("button");
    b.className = "card";
    b.type = "button";
    if (thumb) {
      const img = document.createElement("img");
      img.className = "thumb";
      img.alt = "";
      img.src = thumb;
      b.appendChild(img);
    }
    const n = document.createElement("div");
    n.className = "name";
    n.textContent = label;
    const t = document.createElement("div");
    t.className = "tag";
    t.textContent = tag;
    b.append(n, t);
    b.addEventListener("click", onClick);
    grid.appendChild(b);
  };
  card("Tela onde está o mouse", "Padrão: captura a tela inteira em que o mouse estiver", null, () => window.picker.choose("screen"));
  for (const s of sources) {
    card(s.name, s.screen ? "Tela inteira" : "Janela", s.thumbnail, () => window.picker.choose({ id: s.id, name: s.name }));
  }
})();
