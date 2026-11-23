using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Xml;
using System.Xml.Linq;
using System.Xml.Xsl;

namespace WordEquationTools
{
    internal sealed class InputException : Exception
    {
        internal InputException(string message) : base(message) { }
    }

    internal sealed class Latex
    {
        private static readonly XNamespace Math = "http://www.w3.org/1998/Math/MathML";
        private static readonly Dictionary<string, string> Symbols = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            {"alpha","α"}, {"beta","β"}, {"gamma","γ"}, {"delta","δ"}, {"epsilon","ϵ"},
            {"varepsilon","ε"}, {"zeta","ζ"}, {"eta","η"}, {"theta","θ"}, {"vartheta","ϑ"},
            {"iota","ι"}, {"kappa","κ"}, {"lambda","λ"}, {"mu","μ"}, {"nu","ν"}, {"xi","ξ"},
            {"pi","π"}, {"varpi","ϖ"}, {"rho","ρ"}, {"varrho","ϱ"}, {"sigma","σ"},
            {"varsigma","ς"}, {"tau","τ"}, {"upsilon","υ"}, {"phi","ϕ"}, {"varphi","φ"},
            {"chi","χ"}, {"psi","ψ"}, {"omega","ω"}, {"Gamma","Γ"}, {"Delta","Δ"},
            {"Theta","Θ"}, {"Lambda","Λ"}, {"Xi","Ξ"}, {"Pi","Π"}, {"Sigma","Σ"},
            {"Upsilon","Υ"}, {"Phi","Φ"}, {"Psi","Ψ"}, {"Omega","Ω"},
            {"times","×"}, {"cdot","·"}, {"div","÷"}, {"pm","±"}, {"mp","∓"},
            {"le","≤"}, {"leq","≤"}, {"ge","≥"}, {"geq","≥"}, {"neq","≠"}, {"ne","≠"},
            {"approx","≈"}, {"equiv","≡"}, {"sim","∼"}, {"simeq","≃"}, {"propto","∝"},
            {"infty","∞"}, {"partial","∂"}, {"nabla","∇"}, {"degree","°"}, {"circ","∘"},
            {"sum","∑"}, {"prod","∏"}, {"coprod","∐"}, {"int","∫"}, {"iint","∬"}, {"oint","∮"},
            {"in","∈"}, {"notin","∉"}, {"subset","⊂"}, {"subseteq","⊆"}, {"supset","⊃"},
            {"supseteq","⊇"}, {"cup","∪"}, {"cap","∩"}, {"emptyset","∅"},
            {"forall","∀"}, {"exists","∃"}, {"neg","¬"}, {"land","∧"}, {"lor","∨"},
            {"to","→"}, {"rightarrow","→"}, {"leftarrow","←"}, {"leftrightarrow","↔"},
            {"Rightarrow","⇒"}, {"Leftarrow","⇐"}, {"Leftrightarrow","⇔"}, {"mapsto","↦"},
            {"ldots","…"}, {"dots","…"}, {"cdots","⋯"}, {"vdots","⋮"}, {"ddots","⋱"},
            {"langle","⟨"}, {"rangle","⟩"}, {"lvert","|"}, {"rvert","|"},
            {"lVert","‖"}, {"rVert","‖"}, {"vert","|"}, {"Vert","‖"}, {"|","‖"},
            {"{","{"}, {"}","}"}, {"%","%"}, {"&","&"}, {"_","_"}, {"$","$"}, {"#","#"}
        };
        private static readonly HashSet<string> Functions = new HashSet<string>(
            "sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh exp log ln lim min max det gcd inf sup ker".Split(' '),
            StringComparer.Ordinal);
        private static readonly HashSet<string> Limits = new HashSet<string>(
            "∑ ∏ ∐ lim min max inf sup".Split(' '), StringComparer.Ordinal);
        private static readonly Dictionary<string, string> Accents = new Dictionary<string, string>
        {
            {"hat","^"}, {"widehat","^"}, {"bar","¯"}, {"overline","¯"}, {"vec","→"},
            {"dot","˙"}, {"ddot","¨"}, {"tilde","~"}, {"widetilde","~"}
        };

        private readonly string input;
        private int pos;
        private int depth;

        private Latex(string input) { this.input = input; }

        internal static XElement Parse(string raw)
        {
            if (String.IsNullOrWhiteSpace(raw)) throw new InputException("请输入 LaTeX 公式。");
            if (raw.Length > 4096) throw new InputException("单条公式最多可输入 4096 个字符。");
            foreach (char c in raw)
                if (Char.IsControl(c) && c != '\r' && c != '\n' && c != '\t')
                    throw new InputException("公式含有无法处理的控制字符。");
            var source = raw.Trim();
            foreach (var pair in new[] { new[] {"$$","$$"}, new[] { @"\[", @"\]" }, new[] { @"\(", @"\)" }, new[] { "$", "$" } })
            {
                if (source.Length >= pair[0].Length + pair[1].Length &&
                    source.StartsWith(pair[0], StringComparison.Ordinal) &&
                    source.EndsWith(pair[1], StringComparison.Ordinal))
                {
                    source = source.Substring(pair[0].Length, source.Length - pair[0].Length - pair[1].Length).Trim();
                    break;
                }
            }
            if (source.Length == 0) throw new InputException("公式内容为空。");
            var parser = new Latex(source);
            var row = parser.Row('\0', null, false);
            if (parser.pos != source.Length) throw parser.Error("遇到不匹配的结束符号");
            if (!row.HasElements) throw parser.Error("公式内容为空");
            return new XElement(Math + "math", new XAttribute("display", "block"), row);
        }

        private void Space() { while (pos < input.Length && Char.IsWhiteSpace(input[pos])) pos++; }
        private bool Ahead(string text)
        {
            return pos + text.Length <= input.Length &&
                String.CompareOrdinal(input, pos, text, 0, text.Length) == 0;
        }
        private bool AheadCommand(string text)
        {
            return Ahead(text) && (pos + text.Length == input.Length || !Letter(input[pos + text.Length]));
        }
        private static bool Letter(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
        private InputException Error(string message)
        {
            return new InputException(message + "（位置 " + (pos + 1).ToString(CultureInfo.InvariantCulture) + "）。");
        }
        private string Command()
        {
            pos++;
            if (pos == input.Length) throw Error("反斜杠后缺少命令");
            int start = pos++;
            if (Letter(input[start]))
                while (pos < input.Length && Letter(input[pos])) pos++;
            return input.Substring(start, pos - start);
        }
        private static XElement Element(string name, params object[] content) { return new XElement(Math + name, content); }

        private XElement Row(char end, string commandEnd, bool inTable)
        {
            var row = Element("mrow");
            Space();
            while (pos < input.Length && input[pos] != end &&
                (commandEnd == null || !AheadCommand(commandEnd)) &&
                (!inTable || !(input[pos] == '&' || Ahead(@"\\"))))
            {
                XElement item = Atom();
                Space();
                XElement sub = null, sup = null;
                bool limits = Limits.Contains(item.Value) && !item.HasElements;
                if (AheadCommand(@"\limits")) { Command(); limits = true; Space(); }
                else if (AheadCommand(@"\nolimits")) { Command(); limits = false; Space(); }
                while (pos < input.Length && (input[pos] == '_' || input[pos] == '^' || input[pos] == '\''))
                {
                    var mark = input[pos++];
                    if (mark == '\'')
                    {
                        if (sup != null) throw Error("重复的上标，使用花括号组合上标");
                        var primes = "′";
                        while (pos < input.Length && input[pos] == '\'') { primes += "′"; pos++; }
                        sup = Element("mo", primes);
                    }
                    else if (mark == '_' && sub == null) { sub = Atom(); }
                    else if (mark == '^' && sup == null) { sup = Atom(); }
                    else { throw Error("重复的上下标"); }
                    Space();
                }
                if (sub != null && sup != null) item = Element(limits ? "munderover" : "msubsup", item, sub, sup);
                else if (sub != null) item = Element(limits ? "munder" : "msub", item, sub);
                else if (sup != null) item = Element(limits ? "mover" : "msup", item, sup);
                row.Add(item);
            }
            return row;
        }

        private XElement Atom()
        {
            if (++depth > 48) throw Error("公式嵌套太深");
            try
            {
                Space();
                if (pos >= input.Length) throw Error("缺少公式内容");
                char c = input[pos];
                if (c == '\\') return FromCommand(Command());
                pos++;
                if (c == '{') return Group('}');
                if ("}_^&$#%".IndexOf(c) >= 0) throw Error("意外的字符 " + c);
                if (Char.IsHighSurrogate(c) && pos < input.Length && Char.IsLowSurrogate(input[pos]))
                    return Element("mi", new string(new[] { c, input[pos++] }));
                if (Char.IsSurrogate(c)) throw Error("无效的 Unicode 字符");
                if (Char.IsDigit(c)) return Element("mn", c.ToString());
                if (Char.IsLetter(c)) return Element("mi", c.ToString());
                return Element("mo", c == '-' ? "−" : c.ToString());
            }
            finally { depth--; }
        }

        private XElement Group(char end)
        {
            var node = Row(end, null, false);
            if (pos == input.Length) throw Error("缺少闭合符号 " + end);
            pos++;
            return node;
        }

        private string RawGroup(bool allowText)
        {
            Space();
            if (pos == input.Length || input[pos++] != '{') throw Error("命令需要花括号参数");
            var start = pos;
            while (pos < input.Length && input[pos] != '}')
            {
                if (input[pos] == '{' || input[pos] == '\\' || (!allowText && !Letter(input[pos])))
                    throw Error("参数里含有不支持的字符");
                pos++;
            }
            if (pos == input.Length) throw Error("缺少右花括号");
            return input.Substring(start, pos++ - start);
        }

        private string Fence()
        {
            Space();
            if (pos >= input.Length) throw Error("定界命令后缺少符号");
            if (input[pos] == '\\')
            {
                string key = Command(), value;
                if (Symbols.TryGetValue(key, out value) && "⟨⟩{}|‖".Contains(value)) return value;
                throw Error("不支持的定界符 " + key);
            }
            char token = input[pos++];
            if (token == '.') return "";
            if ("()[]|<>".IndexOf(token) < 0) throw Error("不支持的定界符 " + token);
            return token.ToString();
        }

        private static XElement Fenced(string start, string end, XElement inner)
        {
            return Element("mfenced", new XAttribute("open", start), new XAttribute("close", end),
                new XAttribute("separators", ""), inner);
        }

        private XElement Environment()
        {
            string name = RawGroup(false);
            if (Array.IndexOf("matrix pmatrix bmatrix Bmatrix vmatrix Vmatrix cases aligned gathered split".Split(' '), name) < 0)
                throw Error("不支持的 LaTeX 环境 " + name);
            var table = Element("mtable");
            if (name == "aligned" || name == "split")
                table.SetAttributeValue("columnalign", "right left");
            else if (name == "cases") table.SetAttributeValue("columnalign", "left left");
            var line = Element("mtr");
            do
            {
                line.Add(Element("mtd", Row('\0', @"\end", true)));
                if (line.Elements().CountMoreThan(16)) throw Error("单行最多支持 16 列");
                if (AheadCommand(@"\end"))
                {
                    Command();
                    if (RawGroup(false) != name) throw Error("LaTeX 环境的结束标记与开始标记不同");
                    table.Add(line);
                    if (table.Elements().CountMoreThan(32)) throw Error("环境最多支持 32 行");
                    break;
                }
                if (Ahead(@"\\"))
                {
                    pos += 2;
                    table.Add(line);
                    if (table.Elements().CountMoreThan(32)) throw Error("环境最多支持 32 行");
                    line = Element("mtr");
                }
                else if (pos < input.Length && input[pos] == '&') pos++;
                else throw Error("缺少环境结束标记");
            } while (true);
            switch (name)
            {
                case "pmatrix": return Fenced("(", ")", table);
                case "bmatrix": return Fenced("[", "]", table);
                case "Bmatrix": return Fenced("{", "}", table);
                case "vmatrix": return Fenced("|", "|", table);
                case "Vmatrix": return Fenced("‖", "‖", table);
                case "cases": return Fenced("{", "", table);
                default: return table;
            }
        }

        private XElement FromCommand(string name)
        {
            switch (name)
            {
                case "frac": case "dfrac": case "tfrac": return Element("mfrac", Atom(), Atom());
                case "binom": case "dbinom": case "tbinom":
                    return Fenced("(", ")", Element("mfrac", new XAttribute("linethickness", "0"), Atom(), Atom()));
                case "sqrt":
                    Space();
                    XElement index = null;
                    if (pos < input.Length && input[pos] == '[') { pos++; index = Group(']'); }
                    var value = Atom();
                    return index == null ? Element("msqrt", value) : Element("mroot", value, index);
                case "text": case "textrm": case "textnormal": return Element("mtext", RawGroup(true));
                case "operatorname": return Element("mi", new XAttribute("mathvariant", "normal"), RawGroup(true));
                case "mathrm": case "mathbf": case "mathit": case "mathsf": case "mathbb": case "mathcal": case "mathfrak": case "mathtt":
                    var style = new Dictionary<string, string> { {"mathrm","normal"}, {"mathbf","bold"}, {"mathit","italic"},
                        {"mathsf","sans-serif"}, {"mathbb","double-struck"}, {"mathcal","script"}, {"mathfrak","fraktur"}, {"mathtt","monospace"} };
                    var styled = Atom();
                    foreach (var leaf in styled.DescendantsAndSelf())
                        if (leaf.Name == Math + "mi" || leaf.Name == Math + "mn" || leaf.Name == Math + "mo")
                            if (leaf.Attribute("mathvariant") == null) leaf.SetAttributeValue("mathvariant", style[name]);
                    return styled;
                case "left":
                    string open = Fence();
                    var enclosed = Row('\0', @"\right", false);
                    if (!AheadCommand(@"\right")) throw Error("找不到匹配的 \\right");
                    Command();
                    return Fenced(open, Fence(), enclosed);
                case "begin": return Environment();
                case "overset": var top = Atom(); return Element("mover", Atom(), top);
                case "underset": var bottom = Atom(); return Element("munder", Atom(), bottom);
                case "underline": return Element("munder", new XAttribute("accentunder", "true"), Atom(), Element("mo", "_"));
                case "quad": return Element("mspace", new XAttribute("width", "1em"));
                case "qquad": return Element("mspace", new XAttribute("width", "2em"));
                case ",": case ":": case ";": case " ": return Element("mspace", new XAttribute("width", "0.25em"));
                case "!": return Element("mspace", new XAttribute("width", "0em"));
                case "displaystyle": case "textstyle": case "scriptstyle": return Atom();
            }
            string symbol;
            if (Accents.TryGetValue(name, out symbol))
                return Element("mover", new XAttribute("accent", "true"), Atom(), Element("mo", symbol));
            if (Functions.Contains(name)) return Element("mi", new XAttribute("mathvariant", "normal"), name);
            if (Symbols.TryGetValue(name, out symbol)) return Element(Char.IsLetter(symbol[0]) ? "mi" : "mo", symbol);
            throw Error("暂不支持命令 \\" + name);
        }
    }

    internal static class XmlMath
    {
        internal static readonly XNamespace M = "http://schemas.openxmlformats.org/officeDocument/2006/math";
        internal static readonly XNamespace W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

        internal static XElement ToOffice(XElement math, decimal size, string stylesheet)
        {
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };
            var transform = new XslCompiledTransform();
            using (var reader = XmlReader.Create(stylesheet, settings))
                transform.Load(reader, XsltSettings.Default, null);
            var result = new XDocument();
            using (var input = math.CreateReader())
            using (var output = result.CreateWriter())
                transform.Transform(input, output);
            var equation = result.Root.Name == M + "oMath" ? result.Root : result.Root.Element(M + "oMath");
            if (equation == null) throw new InputException("Word 无法生成这个公式。");
            foreach (var run in equation.Descendants(M + "r"))
            {
                var props = run.Element(W + "rPr");
                if (props == null)
                {
                    props = new XElement(W + "rPr");
                    var mathProps = run.Element(M + "rPr");
                    if (mathProps == null) run.AddFirst(props); else mathProps.AddAfterSelf(props);
                }
                props.SetElementValue(W + "sz", null);
                props.Add(new XElement(W + "sz", new XAttribute(W + "val", (int)(size * 2))));
            }
            return equation;
        }
    }

    internal static class SequenceLimits
    {
        internal static bool CountMoreThan<T>(this IEnumerable<T> items, int limit)
        {
            foreach (var item in items) if (--limit < 0) return true;
            return false;
        }
    }
}
