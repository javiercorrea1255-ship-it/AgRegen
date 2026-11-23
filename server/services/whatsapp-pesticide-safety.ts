// Quantities alone are not pesticide evidence: fertilizer, irrigation, costs and
// retrospective ledger citations must never be reclassified as treatment advice.
const pesticide = /\b(?:plaguicidas?|pesticidas?|insecticidas?|fungicidas?|herbicidas?|acaricidas?|nematicidas?|glifosato|clorpirifos|cipermetrina|imidacloprid|abamectina|mancozeb|clorotalonil|paraquat)\b/i;
const imperative = /\b(?:aplica|aplique|apliquen|usa|use|utiliza|utilice|fumiga|fumigue|rocía|rocíe|rocia|rocie|pulveriza|pulverice|mezcla|mezcle|trata|trate)\b/gi;
const modal = /\b(?:debes?|deber[ií]as?|puedes?|podr[ií]as?|conviene|recomiendo|recomendamos|sugiero|aconsejo|necesitas?|hay\s+que|se\s+debe)\b[^.!?;\n]{0,60}\b(?:aplicar|usar|utilizar|fumigar|rociar|pulverizar|mezclar|tratar)\b/gi;
const infinitiveAction = /(?:^|acción:\s*|recomendaci[oó]n:\s*)(?:aplicar|usar|utilizar|fumigar|rociar|pulverizar|mezclar|tratar)\b/gi;
const directRecommendation = new RegExp(
  String.raw`\b(?:recomiendo|recomendamos|sugiero|aconsejo)\s+(?:el\s+uso\s+de\s+|un[a]?\s+|el\s+|la\s+)?${pesticide.source}`, "gi");
const negative = /(?:\bno(?:\s+te)?|\bnunca|\bevitar?|\bsin|\bprohibido)(?:\s+(?:debes?|deber[ií]as?|se\s+debe|te\s+recomiendo|recomiendo|es\s+necesario))*\s*$/i;

export function recommendsPesticide(clause: string): boolean {
  if (!pesticide.test(clause) || /^\s*[¿?]/.test(clause)) return false;
  return [imperative, modal, infinitiveAction, directRecommendation].some(pattern => {
    pattern.lastIndex = 0;
    return Array.from(clause.matchAll(pattern)).some(match => {
      const prefix = clause.slice(0, match.index);
      return !negative.test(prefix)
        && !/\b(?:si|cuando)\s*$/i.test(prefix)
        && !/\b(?:registr[oó]|registraste|reportaste)\s+(?:que\s+)?$/i.test(prefix);
    });
  });
}

export function pesticideClauses(text: string) {
  // Do not split decimal doses such as 2.5 L/ha.
  return text.split(/(?<=[.!?;])\s+|\n+/).filter(Boolean);
}
