import type { BinderList } from "../lib/list-export";
import { escape } from "./binder-pages";

export function printLists(lists: BinderList[], all: boolean, status: "ordered" | "missing") {
  const title = (all ? "All binders" : lists[0].name) + (status === "ordered" ? " · Ordered cards" : " · Missing cards");
  const sections = lists.map((list, index) => {
    const heading = all ? "<h2>" + (index + 1) + ". " + escape(list.name) + "</h2>" : "";
    const description = [list.setName, list.rows.length + (status === "ordered" ? " ordered" : " still to find"),
      list.settings.columns + " × " + list.settings.rows + " pockets per side"].filter(Boolean).join(" · ");
    const rows = list.rows.map(r => {
      const national = !list.setName;
      const number = national ? "#" + String(r.number).padStart(4, "0") : r.number;
      const printing = national ? "" : "<br><small>" + escape(r.finish) + (r.required === false ? " · Optional" : "") + "</small>";
      return "<tr><td>☐ " + escape(number) + "</td><td>" + escape(r.name) + printing + "</td><td>" + r.page +
        "</td><td>" + r.sheet + " / " + r.side + "</td><td>" + r.pocket + "</td><td>" + r.row + " / " + r.column + "</td></tr>";
    }).join("");
    const table = rows ? "<table><thead><tr><th>Number</th><th>Card</th><th>Page</th><th>Sheet / side</th><th>Pocket</th><th>Row / column</th></tr></thead><tbody>" + rows + "</tbody></table>" : "";
    return "<section>" + heading + "<p>" + escape(description) + "</p>" + table + "</section>";
  });
  document.getElementById("print-content")!.innerHTML = "<h1>" + escape(title) + "</h1>" + sections.join("");
  window.print();
}
