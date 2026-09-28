function bibEscape(value) {
  return String(value || "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

function authorsOf(source) {
  if (Array.isArray(source.authors)) return source.authors.map(bibEscape).filter(Boolean);
  if (typeof source.authors === "string") return source.authors.split(/[;,]/).map(bibEscape).filter(Boolean);
  return [];
}

function citeKey(source, index) {
  const authors = authorsOf(source);
  const author = authors[0]?.split(/\s+/).at(-1) || "source";
  const normalizedAuthor = author.normalize("NFKD").replace(/[^a-zA-Z0-9]/g, "") || "source";
  const year = Number(source.publication_year) || "nd";
  return `${normalizedAuthor}${year}${String(index + 1).padStart(2, "0")}`;
}

export function buildVerifiedBibtex(sources) {
  const eligible = sources.filter((source) => ["metadata-verified", "content-verified"].includes(source.status) && String(source.title || "").trim());
  if (!eligible.length) throw Object.assign(new Error("没有已核验且包含题名的来源，不能生成 BibTeX"), { statusCode: 409 });
  return `${eligible.map((source, index) => {
    const authors = authorsOf(source);
    const entryType = source.venue ? "article" : "misc";
    const fields = [
      `  title = {${bibEscape(source.title)}}`,
      authors.length ? `  author = {${authors.join(" and ")}}` : null,
      source.publication_year ? `  year = {${source.publication_year}}` : null,
      source.venue ? `  journal = {${bibEscape(source.venue)}}` : null,
      source.doi ? `  doi = {${bibEscape(String(source.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""))}}` : null,
      source.url ? `  url = {${bibEscape(source.url)}}` : null,
      `  note = {Human-verified in AI Research Workbench; source_id=${source.id}}`,
    ].filter(Boolean);
    return `@${entryType}{${citeKey(source, index)},\n${fields.join(",\n")}\n}`;
  }).join("\n\n")}\n`;
}
