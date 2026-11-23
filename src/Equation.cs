using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Xml;
using System.Xml.Linq;
using Microsoft.Win32;
using Word = Microsoft.Office.Interop.Word;

namespace WordEquationTools
{
    internal enum Layout { Current = 0, Single = 1, Double = 2 }
    internal enum Editor { Word, MathType }

    internal sealed class EquationOptions
    {
        internal readonly string Latex, Before, After;
        internal readonly decimal Size;
        internal readonly int? Restart;
        internal readonly Layout Layout;
        internal readonly Editor Editor;
        internal readonly bool PreserveMathTypeSize;

        internal EquationOptions(string latex, decimal size, Layout layout, string pattern, string restart,
            Editor editor = Editor.Word, bool preserveMathTypeSize = true)
        {
            if (size < 6 || size > 72 || size * 2 != Math.Truncate(size * 2))
                throw new InputException("公式字号须为 6 到 72 磅，按 0.5 磅递增。");
            if (pattern == null || pattern.Length > 36 || pattern.Any(c => Char.IsControl(c) || Char.GetUnicodeCategory(c) == UnicodeCategory.Format))
                throw new InputException("编号格式最多 36 个字符，须写在一行。");
            try { XmlConvert.VerifyXmlChars(pattern); }
            catch (XmlException) { throw new InputException("编号格式包含 Word 无法保存的字符。"); }
            int token = pattern.IndexOf("{n}", StringComparison.Ordinal);
            if (token < 0 || pattern.IndexOf("{n}", token + 3, StringComparison.Ordinal) >= 0)
                throw new InputException("编号格式请保留一个 {n}，如 ({n}) 或 (A-{n})。");
            Before = pattern.Substring(0, token);
            After = pattern.Substring(token + 3);
            Layout = layout;
            Editor = editor;
            PreserveMathTypeSize = preserveMathTypeSize;
            Latex = latex;
            Size = size;
            if (!String.IsNullOrWhiteSpace(restart))
            {
                int value;
                if (!Int32.TryParse(restart, NumberStyles.None, CultureInfo.InvariantCulture, out value) || value < 1 || value > 999999)
                    throw new InputException("起始编号请留空，或填写 1 到 999999 的整数。");
                Restart = value;
            }
        }
    }

    internal static class Equation
    {
        internal const string Sequence = "WordEquationToolsNumber";
        private static readonly XNamespace W = XmlMath.W;
        private static readonly XNamespace Package = "http://schemas.microsoft.com/office/2006/xmlPackage";
        private static readonly XNamespace Relationships = "http://schemas.openxmlformats.org/package/2006/relationships";

        internal static Word.Range ValidateSelection(Word.Document doc, Word.Range location)
        {
            if (doc.ReadOnly || doc.ProtectionType != Word.WdProtectionType.wdNoProtection)
                throw new InputException("请打开可编辑的 Word 文档。");
            if (location.Start != location.End || location.StoryType != Word.WdStoryType.wdMainTextStory ||
                (bool)location.get_Information(Word.WdInformation.wdWithInTable))
                throw new InputException("请把光标放在正文的独立段落里。");
            if ((bool)location.get_Information(Word.WdInformation.wdInContentControl))
                throw new InputException("请把光标移到内容控件外的正文段落。");
            return location.Paragraphs[1].Range;
        }

        internal static int UpdateNumbers(Word.Document doc)
        {
            if (doc.ReadOnly || doc.ProtectionType != Word.WdProtectionType.wdNoProtection) return 0;
            int touched = 0;
            int value = 0;
            foreach (Word.Field field in doc.Content.Fields)
            {
                if (field.Type != Word.WdFieldType.wdFieldSequence || field.Code.Fields.Count != 0) continue;
                string[] code = field.Code.Text.Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
                int? restart;
                if (!IsOurCode(code, out restart)) continue;
                value = restart ?? (value + 1);
                string result = value.ToString(CultureInfo.InvariantCulture);
                if (!field.Locked && field.Result.Text != result) field.Result.Text = result;
                touched++;
            }
            return touched;
        }

        private static bool IsOurCode(string[] code, out int? restart)
        {
            restart = null;
            if ((code.Length != 4 && code.Length != 6) ||
                !String.Equals(code[0], "SEQ", StringComparison.OrdinalIgnoreCase) ||
                !String.Equals(code[1], Sequence, StringComparison.OrdinalIgnoreCase) ||
                code[2] != @"\*" || !String.Equals(code[3], "ARABIC", StringComparison.OrdinalIgnoreCase)) return false;
            if (code.Length == 4) return true;
            int value;
            if (code[4] != @"\r" || !Int32.TryParse(code[5], NumberStyles.None, CultureInfo.InvariantCulture, out value) ||
                value < 1 || value > 999999) return false;
            restart = value;
            return true;
        }

        internal static Word.Range Insert(Word.Application app, Word.Document doc, Word.Range location, EquationOptions options,
            Action<Word.Application, Word.Range> openMathType = null)
        {
            var para = ValidateSelection(doc, location);
            string mathAnchor = options.Editor == Editor.MathType ? NewToken() : null;
            XElement equation;
            if (options.Editor == Editor.MathType)
            {
                MathTypeEditor.EnsureAvailable(app);
                equation = TextRun(mathAnchor);
            }
            else
            {
                string stylesheet = Path.Combine(app.Path, "MML2OMML.XSL");
                if (!File.Exists(stylesheet)) throw new InputException("当前 Word 安装缺少公式转换组件。");
                equation = XmlMath.ToOffice(Latex.Parse(options.Latex), options.Size, stylesheet);
            }
            string fragment = BuildFragment(equation, options);
            int currentLayout = para.Sections[1].PageSetup.TextColumns.Count;
            int requestedLayout = options.Layout == Layout.Current ? currentLayout : (int)options.Layout;
            string token = NewToken();
            int end = para.End - 1;
            bool empty = para.Text == "\r";
            int originalEnd = doc.Content.End;
            object originalStyle = empty ? para.get_Style() : null;
            var originalFormat = empty ? para.ParagraphFormat.Duplicate : null;
            var undo = app.UndoRecord;
            bool changed = false;
            bool finished = false;
            bool changedOnlySection = false;
            undo.StartCustomRecord("插入带编号公式");
            try
            {
                var insertion = doc.Range(end, end);
                insertion.Text = (empty ? "" : "\r") + token;
                changed = true;
                var marked = FindToken(doc, token, end);
                if (options.Editor == Editor.Word && currentLayout != requestedLayout)
                {
                    if (doc.Paragraphs.Count == 1 && doc.Sections.Count == 1)
                    {
                        doc.Sections[1].PageSetup.TextColumns.SetCount(requestedLayout);
                        changedOnlySection = true;
                    }
                    else
                    {
                        doc.Range(marked.End, marked.End).InsertBreak(Word.WdBreakType.wdSectionBreakContinuous);
                        doc.Range(marked.Start, marked.Start).InsertBreak(Word.WdBreakType.wdSectionBreakContinuous);
                        marked = FindToken(doc, token, end);
                        var ownSection = marked.Sections[1];
                        ownSection.PageSetup.TextColumns.SetCount(requestedLayout);
                        if (ownSection.PageSetup.TextColumns.Count != requestedLayout)
                            throw new InvalidOperationException("Word did not apply the requested columns.");
                    }
                }
                int start = marked.Start;
                marked.InsertXML(fragment);
                var inserted = doc.Range(start, start).Paragraphs[1].Range;
                if (inserted.Fields.Count != 1)
                    throw new InvalidOperationException("Word did not import the numbered equation paragraph.");
                inserted.set_Style(Word.WdBuiltinStyle.wdStyleNormal);
                var format = inserted.ParagraphFormat;
                format.Reset();
                format.Alignment = Word.WdParagraphAlignment.wdAlignParagraphLeft;
                format.ReadingOrder = Word.WdReadingOrder.wdReadingOrderLtr;
                format.LeftIndent = 0;
                format.RightIndent = 0;
                format.FirstLineIndent = 0;
                format.CharacterUnitLeftIndent = 0;
                format.CharacterUnitRightIndent = 0;
                format.CharacterUnitFirstLineIndent = 0;
                format.LineSpacingRule = Word.WdLineSpacing.wdLineSpaceSingle;
                format.KeepTogether = -1;
                format.KeepWithNext = 0;
                format.PageBreakBefore = 0;
                if (options.Editor == Editor.Word)
                {
                    if (inserted.OMaths.Count != 1)
                        throw new InvalidOperationException("Word did not import the math object.");
                    inserted.OMaths[1].Range.Font.Size = (float)options.Size;
                    if (inserted.ComputeStatistics(Word.WdStatistic.wdStatisticLines) > 1)
                        throw new InputException("公式和编号放不进同一行。请缩小字号、使用单栏或把公式写成多行结构。");
                }
                else
                {
                    var mathLocation = FindToken(doc, mathAnchor, start);
                    int point = mathLocation.Start;
                    mathLocation.Text = "";
                    (openMathType ?? MathTypeEditor.Open)(app, doc.Range(point, point));
                    inserted = doc.Range(start, start).Paragraphs[1].Range;
                    if (inserted.InlineShapes.Count != 1 || !MathTypeEditor.IsEmbeddedEquation(inserted.InlineShapes[1]))
                        throw new InputException("MathType 未生成公式。请检查桌面版 MathType 的授权和 Word 加载状态。");
                    var shape = inserted.InlineShapes[1];
                    if (currentLayout != requestedLayout)
                    {
                        if (doc.Paragraphs.Count == 1 && doc.Sections.Count == 1)
                        {
                            doc.Sections[1].PageSetup.TextColumns.SetCount(requestedLayout);
                            changedOnlySection = true;
                        }
                        else
                        {
                            doc.Range(inserted.End - 1, inserted.End - 1).InsertBreak(Word.WdBreakType.wdSectionBreakContinuous);
                            doc.Range(start, start).InsertBreak(Word.WdBreakType.wdSectionBreakContinuous);
                            shape.Range.Sections[1].PageSetup.TextColumns.SetCount(requestedLayout);
                            inserted = shape.Range.Paragraphs[1].Range;
                        }
                    }
                    if (!options.PreserveMathTypeSize)
                    {
                        try { MathTypeEditor.SetDisplayedSize(shape, options.Size); }
                        catch (COMException error) { System.Diagnostics.Trace.WriteLine("WordEquationTools: MathType scaling HRESULT " + error.ErrorCode); }
                    }
                }
                UpdateNumbers(doc);
                finished = true;
                return inserted;
            }
            finally
            {
                try
                {
                    if (changed && !finished)
                    {
                        // These operations only add content at the original paragraph boundary.
                        // Removing that span leaves the pre-existing terminal mark and surrounding text intact.
                        int added = doc.Content.End - originalEnd;
                        if (added > 0) doc.Range(end, end + added).Delete();
                        if (changedOnlySection) doc.Sections[1].PageSetup.TextColumns.SetCount(currentLayout);
                        if (empty)
                        {
                            var restored = doc.Range(end, end).Paragraphs[1].Range;
                            restored.set_Style(originalStyle);
                            restored.ParagraphFormat = originalFormat;
                        }
                    }
                }
                finally { undo.EndCustomRecord(); }
            }
        }

        private static string NewToken() { return "WordEq" + Guid.NewGuid().ToString("N"); }

        private static Word.Range FindToken(Word.Document doc, string token, int near)
        {
            var range = doc.Range(Math.Max(0, near - 2), Math.Min(doc.Content.End, near + token.Length + 8));
            if (!range.Find.Execute(FindText: token, MatchCase: true, MatchWholeWord: false, MatchWildcards: false,
                MatchSoundsLike: false, MatchAllWordForms: false, Forward: true, Wrap: Word.WdFindWrap.wdFindStop, Format: false))
                throw new InvalidOperationException("The equation insertion position could not be recovered.");
            return range;
        }

        internal static string BuildFragment(XElement equation, EquationOptions options)
        {
            string code = " SEQ " + Sequence + " \\* ARABIC ";
            if (options.Restart.HasValue) code += "\\r " + options.Restart.Value.ToString(CultureInfo.InvariantCulture) + " ";
            var paragraph = new XElement(W + "p", AlignmentTab("center"), equation, AlignmentTab("right"),
                TextRun(options.Before), new XElement(W + "fldSimple", new XAttribute(W + "instr", code),
                    TextRun(options.Restart.GetValueOrDefault(1).ToString(CultureInfo.InvariantCulture))), TextRun(options.After));
            var relations = new XElement(Relationships + "Relationships", new XElement(Relationships + "Relationship",
                new XAttribute("Id", "rId1"),
                new XAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"),
                new XAttribute("Target", "word/document.xml")));
            return new XElement(Package + "package", new XAttribute(XNamespace.Xmlns + "pkg", Package),
                Part("/_rels/.rels", "application/vnd.openxmlformats-package.relationships+xml", relations),
                Part("/word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
                    new XElement(W + "document", new XAttribute(XNamespace.Xmlns + "w", W),
                        new XAttribute(XNamespace.Xmlns + "m", XmlMath.M), new XElement(W + "body", paragraph))))
                .ToString(SaveOptions.DisableFormatting);
        }

        private static XElement Part(string name, string type, XElement body)
        {
            return new XElement(Package + "part", new XAttribute(Package + "name", name),
                new XAttribute(Package + "contentType", type), new XElement(Package + "xmlData", body));
        }

        private static XElement TextRun(string text)
        {
            return new XElement(W + "r", new XElement(W + "t", new XAttribute(XNamespace.Xml + "space", "preserve"), text));
        }

        private static XElement AlignmentTab(string alignment)
        {
            return new XElement(W + "r", new XElement(W + "ptab", new XAttribute(W + "alignment", alignment),
                new XAttribute(W + "relativeTo", "margin"), new XAttribute(W + "leader", "none")));
        }
    }

    internal static class MathTypeEditor
    {
        private const string Template = "MathType Commands 2016.dotm";
        private const string InlineCommand = "'" + Template + "'!MTCommand_InsertInlineEqn";

        internal static void EnsureAvailable(Word.Application app)
        {
            foreach (Word.AddIn addIn in app.AddIns)
                if (addIn.Installed && String.Equals(addIn.Name, Template, StringComparison.OrdinalIgnoreCase) &&
                    Type.GetTypeFromProgID("Equation.DSMT4", false) != null) return;
            throw new InputException("请先在 Word 中启用可用的 MathType 7 桌面版加载项。");
        }

        internal static void Open(Word.Application app, Word.Range at)
        {
            at.Select();
            try { app.Run(InlineCommand); }
            catch (COMException) { throw new InputException("无法打开 MathType 编辑器。请先试用 Word 的 MathType → 内联。"); }
        }

        internal static bool IsEmbeddedEquation(Word.InlineShape shape)
        {
            return shape.Type == Word.WdInlineShapeType.wdInlineShapeEmbeddedOLEObject &&
                String.Equals(shape.OLEFormat.ProgID, "Equation.DSMT4", StringComparison.OrdinalIgnoreCase);
        }

        internal static float DisplayScale(decimal points)
        {
            decimal full = 12;
            using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Design Science\DSMT7\Sizes", false))
            {
                var value = key == null ? "" : key.GetValue("Full", "") as string ?? "";
                if (value.EndsWith(" pt", StringComparison.OrdinalIgnoreCase))
                {
                    decimal parsed;
                    var text = value.Substring(0, value.Length - 3);
                    if ((Decimal.TryParse(text, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out parsed) ||
                        Decimal.TryParse(text, NumberStyles.AllowDecimalPoint, CultureInfo.CurrentCulture, out parsed)) &&
                        parsed >= 4 && parsed <= 144) full = parsed;
                }
            }
            return (float)(points / full);
        }

        internal static void SetDisplayedSize(Word.InlineShape shape, decimal points)
        {
            float scale = DisplayScale(points);
            float width = shape.Width * scale;
            float height = shape.Height * scale;
            var previous = shape.LockAspectRatio;
            shape.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoFalse;
            try
            {
                shape.Width = width;
                shape.Height = height;
            }
            finally { shape.LockAspectRatio = previous; }
        }
    }
}
