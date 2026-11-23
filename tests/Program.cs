using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Xml.Linq;
using Word = Microsoft.Office.Interop.Word;

namespace WordEquationTools
{
    internal static class Tests
    {
        private static int checks;

        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                UnitTests();
                if (args.Length == 2 && args[0] == "--ui")
                    DialogTests(Path.GetFullPath(args[1]));
                else if (args.Length > 0)
                    Integration(Path.GetFullPath(args[0]), args.Contains("--installed"), args.Contains("--mathtype"), args.Contains("--only-mixed"));
                Console.WriteLine("PASS: " + checks + " assertions");
                return 0;
            }
            catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        }

        private static void DialogTests(string path)
        {
            Directory.CreateDirectory(path);
            System.Windows.Forms.Application.EnableVisualStyles();
            using (var form = new EquationDialog(null, null, null, 12M, Editor.Word, "({n})", 2))
            {
                form.Opacity = 0;
                form.Show();
                Check(Screen.FromControl(form).WorkingArea.Contains(form.Bounds), "initial window fits the available screen");
                form.ClientSize = new Size(980, 638);
                System.Windows.Forms.Application.DoEvents();
                var input = (TextBox)Find(form, "Latex");
                var editor = Find(form, "EditorCard");
                var settings = Find(form, "SettingsCard");
                var mathType = (RadioButton)Find(form, "MathTypeMode");
                var wordMode = (RadioButton)Find(form, "WordMode");
                var insert = (Button)Find(form, "InsertFormula");
                Check(input.Visible && input.Width >= 440 && input.Height >= 300,
                    "wide multiline editor: " + input.Size);
                Check(settings.Left > editor.Right && settings.Top == editor.Top, "wide layout puts settings beside editor");
                Check(!Find(form, "MathTypePanel").Visible, "Word mode hides MathType instructions");

                ((Button)Find(form, "Latex分式")).PerformClick();
                Check(input.Text == @"\frac{a}{b}" && input.SelectedText == "a", "fraction snippet selects the first placeholder");
                input.Text = "x^2";
                input.Select(0, input.TextLength);
                ((Button)Find(form, "Latex根号")).PerformClick();
                Check(input.Text == @"\sqrt{x^2}", "snippet wraps selected equation");
                input.Clear();
                ((Button)Find(form, "LatexExample")).PerformClick();
                Check(input.Text.Contains(@"\sqrt") && !Find(form, "LatexExample").Enabled, "example fills an empty editor and protects a draft");
                input.Text = @"\frac{a_1 + a_2}{2}" + Environment.NewLine + @"\qquad + \sqrt{x_i^2 + y_i^2}";
                string formula = input.Text;
                SaveDialog(form, path, "word-wide");

                mathType.Checked = true;
                System.Windows.Forms.Application.DoEvents();
                Check(!input.Visible && Find(form, "MathTypePanel").Visible && insert.Text == "打开 MathType",
                    "MathType shows its instructions and action");
                Check(!Find(form, "EquationFontSize").Enabled, "preserving MathType sizing disables the size override");
                ((CheckBox)Find(form, "PreserveMathTypeSize")).Checked = false;
                Check(Find(form, "EquationFontSize").Enabled, "MathType size override is available");
                SaveDialog(form, path, "mathtype-wide");
                wordMode.Checked = true;
                Check(input.Text == formula && input.Visible, "switching modes keeps the typed formula");

                form.ClientSize = new Size(560, 408);
                System.Windows.Forms.Application.DoEvents();
                SaveDialog(form, path, "word-compact");
                Check(settings.Top >= editor.Bottom && settings.Left == editor.Left, "compact layout stacks the cards");
                Check(input.Height >= 105 && input.Width >= 320, "compact layout keeps a usable input area: " + input.Size);
                var viewport = (Panel)Find(form, "FormulaWorkspace");
                Check(viewport.VerticalScroll.Visible && !viewport.HorizontalScroll.Visible, "short window scrolls vertically (" +
                    viewport.Size + ", display " + viewport.DisplayRectangle + ", content " + Find(form, "WorkspaceContent").Bounds + ")");
                Check(form.RectangleToClient(insert.RectangleToScreen(insert.ClientRectangle)).Bottom <= form.ClientSize.Height,
                    "insert action stays visible on a short window");
                viewport.AutoScrollPosition = new Point(0, settings.Top);
                System.Windows.Forms.Application.DoEvents();
                Check(viewport.VerticalScroll.Value > 0, "compact settings can be reached by scrolling");
                SaveDialog(form, path, "word-compact-settings");

                var fit = (Button)Find(form, "FitScreen");
                fit.PerformClick();
                System.Windows.Forms.Application.DoEvents();
                Check(form.WindowState == FormWindowState.Maximized && fit.Text == "还原窗口", "fits the active screen");
                fit.PerformClick();
                System.Windows.Forms.Application.DoEvents();
                Check(form.WindowState == FormWindowState.Normal && fit.Text == "适应屏幕", "restores the editing window");
                form.Close();
            }
        }

        private static Control Find(Control parent, string name) { return parent.Controls.Find(name, true).Single(); }

        private static void SaveDialog(Form form, string path, string name)
        {
            using (var bitmap = new Bitmap(form.Width, form.Height))
            {
                form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
                bitmap.Save(Path.Combine(path, name + ".png"), System.Drawing.Imaging.ImageFormat.Png);
            }
        }

        private static void Check(bool value, string description)
        {
            if (!value) throw new Exception("Failed: " + description);
            checks++;
        }

        private static void Reject(Action test)
        {
            try { test(); }
            catch (InputException) { checks++; return; }
            throw new Exception("Invalid input was accepted");
        }

        private static void UnitTests()
        {
            var math = XNamespace.Get("http://www.w3.org/1998/Math/MathML");
            var expression = Latex.Parse(@"\[\frac{a_1}{\sqrt[3]{x}} + \sum_{i=1}^n x_i\]");
            Check(expression.Descendants(math + "mfrac").Count() == 1, "fraction");
            Check(expression.Descendants(math + "mroot").Count() == 1, "indexed roots");
            Check(expression.Descendants(math + "munderover").Count() == 1, "sum with two limits");
            Check(expression.Descendants(math + "msub").Count() >= 2, "subscripts");
            var matrix = Latex.Parse(@"\left[\begin{matrix} a & b \\ c & d \end{matrix}\right]");
            Check(matrix.Descendants(math + "mtd").Count() == 4, "matrix");
            Check(matrix.Descendants(math + "mfenced").Count() == 1, "left and right");
            Check(Latex.Parse(@"\text{<>}").Descendants(math + "mtext").Single().Value == "<>", "input is XML text");
            Check(Latex.Parse(@"x''").Descendants(math + "msup").Count() == 1, "primes");
            Reject(() => Latex.Parse(""));
            Reject(() => Latex.Parse(@"\frac{x"));
            Reject(() => Latex.Parse(@"\input{some-file}"));
            Reject(() => Latex.Parse(@"\newcommand{\x}{y}"));
            Reject(() => Latex.Parse(@"\def\x{\x}\x"));
            Reject(() => Latex.Parse(@"\href{https://example.com}{x}"));
            Reject(() => Latex.Parse(@"\begin{aligned} a=1 \end{matrix}"));
            Reject(() => Latex.Parse(@"x_1_2"));
            Reject(() => Latex.Parse(new String('x', 4097)));
            Reject(() => Latex.Parse(new String('{', 60) + "x" + new String('}', 60)));
            Reject(() => Latex.Parse("x\u0001"));
            Reject(() => new EquationOptions("x", 100, Layout.Single, "({n})", ""));
            Reject(() => new EquationOptions("x", 12, Layout.Single, "(1)", ""));
            Reject(() => new EquationOptions("x", 12, Layout.Single, "{n}{n}", ""));
            Reject(() => new EquationOptions("x", 12, Layout.Single, "({n})", @"1 \c"));
            var wrapped = new EquationOptions("x", 12, Layout.Single, "<&{n}>", "10");
            var xml = Equation.BuildFragment(new XElement(XmlMath.M + "oMath"), wrapped);
            Check(XDocument.Parse(xml).Descendants(XmlMath.W + "fldSimple").Single()
                .Attribute(XmlMath.W + "instr").Value == @" SEQ WordEquationToolsNumber \* ARABIC \r 10 ", "only generated SEQ field code");
            Check(XDocument.Parse(xml).Descendants(XmlMath.W + "t").First().Value == "<&", "numbering format is XML text");
        }

        private static void Integration(string path, bool installed, bool mathType, bool onlyMixed)
        {
            Directory.CreateDirectory(path);
            var word = new Word.Application();
            try
            {
                word.DisplayAlerts = Word.WdAlertLevel.wdAlertsNone;
                if (onlyMixed) { MixedEditorsTests(word, path, installed); return; }
                CheckDialogInsertion(word);
                var doc = word.Documents.Add(Visible: false);
                try
                {
                    SetPage(doc);
                    Word.Range first = Insert(word, doc, doc.Range(0, 0), @"\frac{a}{b} + \sqrt{x}", Layout.Single, 18);
                    Check(first.OMaths.Count == 1 && first.OMaths[1].Type == Word.WdOMathType.wdOMathInline, "native editable OMML");
                    Check(first.OMaths[1].Range.Font.Size == 18, "Word math font size");
                    Check(first.Fields[1].Result.Text == "1", "first sequence result");
                    Check(first.WordOpenXML.Contains("w:ptab"), "dynamic alignment tabs survive Word import");
                    Check(first.Sections[1].PageSetup.TextColumns.Count == 1, "single column");

                    Word.Range second = Insert(word, doc, doc.Range(first.End - 1, first.End - 1), @"x_i^2",
                        Layout.Current, 12, "(A-{n})");
                    Check(second.Fields[1].Result.Text == "2" && second.Text.Contains("(A-2)"), "custom prefix and numbering");
                    Word.Range third = Insert(word, doc, doc.Range(second.End - 1, second.End - 1),
                        @"\begin{pmatrix}a&b\\c&d\end{pmatrix}", Layout.Current, 12, "[{n}]", "12");
                    Check(third.Fields[1].Result.Text == "12", "restart numbering");
                    Check(third.OMaths.Count == 1, "structured matrix imports");
                    Render(doc, path, "single");
                    string unchanged = doc.Content.Text;
                    Reject(() => Insert(word, doc, doc.Range(0, 0), @"\input{secret}", Layout.Current, 12));
                    Check(doc.Content.Text == unchanged && doc.OMaths.Count == 3, "invalid formula leaves document intact");
                    Reject(() => Insert(word, doc, doc.Range(0, 0), String.Join("+", Enumerable.Repeat("a_i", 80)),
                        Layout.Current, 30));
                    Check(doc.Content.Text == unchanged && doc.OMaths.Count == 3,
                        "overflow rolls back without leaving a partial formula (math " + doc.OMaths.Count +
                        ", paragraphs " + doc.Paragraphs.Count + ", text " + doc.Content.Text.Length + " versus " + unchanged.Length + ")");
                    var last = doc.OMaths[3].Range.Paragraphs[1].Range;
                    last.Select();
                    Reject(() => Insert(word, doc, word.Selection.Range, "x", Layout.Current, 12));
                    doc.OMaths[1].Range.Paragraphs[1].Range.Delete();
                    if (installed)
                    {
                        Check(word.COMAddIns.Item("WordEquationTools.Connect").Connect, "Word loaded the registered plug-in");
                        doc.SaveAs2(Path.Combine(path, "before-save.docx"), Word.WdSaveFormat.wdFormatXMLDocument);
                        Check(doc.Fields[1].Result.Text == "1", "real plugin auto-updates numbers before save");
                    }
                    else
                    {
                        Check(Equation.UpdateNumbers(doc) == 2, "scoped update counts");
                        Check(doc.Fields[1].Result.Text == "1", "delete and recalculate");
                    }
                    Check(doc.Fields[2].Result.Text == "12", "restart retained after deletion");
                }
                finally { ((Word._Document)doc).Close(Word.WdSaveOptions.wdDoNotSaveChanges); }

                if (mathType) MixedEditorsTests(word, path, installed);

                doc = word.Documents.Add(Visible: false);
                try
                {
                    SetPage(doc);
                    doc.Sections[1].PageSetup.TextColumns.SetCount(2);
                    doc.Sections[1].PageSetup.TextColumns.Spacing = 24;
                    doc.Content.Text = "Left column text\r\r";
                    var point = doc.Paragraphs[2].Range.Start;
                    Word.Range first = Insert(word, doc, doc.Range(point, point), "E=mc^2", Layout.Double, 14);
                    var next = doc.Range(first.End, first.End);
                    next.InsertBreak(Word.WdBreakType.wdColumnBreak);
                    int right = doc.Paragraphs[doc.Paragraphs.Count].Range.Start;
                    doc.Range(right, right).InsertBefore("Right column text\r");
                    int last = doc.Content.End - 1;
                    Word.Range second = Insert(word, doc, doc.Range(last, last), "F=ma", Layout.Double, 14);
                    Check(second.Fields[1].Result.Text == "2" && doc.Sections.Count == 1, "two equations in double-column section");
                    Render(doc, path, "double");
                }
                finally { ((Word._Document)doc).Close(Word.WdSaveOptions.wdDoNotSaveChanges); }

                doc = word.Documents.Add(Visible: false);
                try
                {
                    SetPage(doc);
                    doc.Sections[1].PageSetup.TextColumns.SetCount(2);
                    doc.Content.Text = "Keep the original double column before.\r\rKeep the original double column after.";
                    int point = doc.Paragraphs[2].Range.Start;
                    Word.Range formula = Insert(word, doc, doc.Range(point, point), @"\frac{x_1 + x_2}{2}=y", Layout.Single, 12);
                    Check(doc.Sections.Count == 3, "mixed section boundaries");
                    Check(formula.Sections[1].PageSetup.TextColumns.Count == 1, "single formula spans width");
                    Check(doc.Sections[1].PageSetup.TextColumns.Count == 2 && doc.Sections[3].PageSetup.TextColumns.Count == 2,
                        "surrounding sections keep their columns");
                    Check(doc.Content.Text.Contains("Keep the original double column after."), "surrounding content preserved");
                    Render(doc, path, "mixed");
                    doc.Undo(1);
                    Check(doc.Sections.Count == 1 && doc.OMaths.Count == 0, "one undo removes formula and both section breaks");
                }
                finally { ((Word._Document)doc).Close(Word.WdSaveOptions.wdDoNotSaveChanges); }

                doc = word.Documents.Add(Visible: false);
                try
                {
                    SetPage(doc);
                    Word.Range formula = Insert(word, doc, doc.Range(0, 0), "x+1", Layout.Double, 11);
                    Check(formula.Sections[1].PageSetup.TextColumns.Count == 2, "double layout from an empty document");
                }
                finally { ((Word._Document)doc).Close(Word.WdSaveOptions.wdDoNotSaveChanges); }
            }
            finally
            {
                ((Word._Application)word).Quit(Word.WdSaveOptions.wdDoNotSaveChanges);
                Marshal.FinalReleaseComObject(word);
            }
        }

        private static void CheckDialogInsertion(Word.Application word)
        {
            var doc = word.Documents.Add(Visible: false);
            try
            {
                using (var form = new EquationDialog(word, doc, doc.Range(0, 0), 14M, Editor.Word, "({n})", 1))
                {
                    form.Opacity = 0;
                    form.Shown += (sender, args) =>
                    {
                        Find(form, "Latex").Text = @"\frac{a}{b}";
                        ((Button)Find(form, "InsertFormula")).PerformClick();
                        if (form.DialogResult != DialogResult.OK) form.DialogResult = DialogResult.Cancel;
                    };
                    Check(form.ShowFor(null) == DialogResult.OK, "the updated dialog submits to Word");
                    Check(doc.OMaths.Count == 1 && doc.OMaths[1].Range.Font.Size == 14 &&
                        SequenceFields(doc.Content).Single().Result.Text == "1", "dialog inserts the editable formula and its number");
                }
            }
            finally { ((Word._Document)doc).Close(Word.WdSaveOptions.wdDoNotSaveChanges); }
        }

        private static void MixedEditorsTests(Word.Application word, string path, bool installed)
        {
            string fixturePath = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "tests", "mathtype-fixture.docx"));
            var fixture = word.Documents.Open(fixturePath, ReadOnly: true, AddToRecentFiles: false, Visible: false);
            var doc = word.Documents.Add(Visible: false);
            try
            {
                SetPage(doc);
                var first = Insert(word, doc, doc.Range(0, 0), "E=mc^2", Layout.Single, 13);
                var options = new EquationOptions("", 18, Layout.Double, "(M-{n})", "", Editor.MathType, false);
                var before = doc.Content.Text;
                int firstEnd = first.End - 1;
                Reject(() => Equation.Insert(word, doc, doc.Range(firstEnd, firstEnd), options, (app, target) => {}));
                Check(doc.Content.Text == before && doc.Sections.Count == 1 && doc.Fields.Count == 1,
                    "unavailable MathType leaves neither numbering nor extra sections (length " + doc.Content.Text.Length +
                    " vs " + before.Length + ", sections " + doc.Sections.Count + ", fields " + doc.Fields.Count + ")");
                var nextAfterFirst = doc.OMaths[1].Range.Paragraphs[1].Range.End - 1;
                var second = Equation.Insert(word, doc, doc.Range(nextAfterFirst, nextAfterFirst), options, (app, target) =>
                {
                    // Reuse a genuine object generated in Word to test formatting independently of interactive MathType licensing.
                    target.FormattedText = fixture.InlineShapes[1].Range.FormattedText;
                });
                Check(second.InlineShapes.Count == 1 && MathTypeEditor.IsEmbeddedEquation(second.InlineShapes[1]),
                    "editable MathType OLE alongside Word OMML");
                Check(SequenceFields(second)[0].Result.Text == "2" && second.Text.Contains("(M-2)"),
                    "MathType uses the same sequence as Word");
                Check(second.Sections[1].PageSetup.TextColumns.Count == 2, "MathType equation has actual double-column layout");
                var fixtureShape = fixture.InlineShapes[1];
                var resized = second.InlineShapes[1];
                float factor = MathTypeEditor.DisplayScale(18);
                Check(Math.Abs(resized.Width - fixtureShape.Width * factor) < 1.0 &&
                    Math.Abs(resized.Height - fixtureShape.Height * factor) < 1.0,
                    "MathType display size (actual " + resized.Width + " x " + resized.Height +
                    ", before " + fixtureShape.Width + " x " + fixtureShape.Height + ", scale " + factor + ")");
                var next = second.End - 1;
                var third = Insert(word, doc, doc.Range(next, next), @"x_i", Layout.Current, 11);
                Check(third.Fields[1].Result.Text == "3", "Word equation continues the shared mixed sequence");
                Render(doc, path, "mixed-editors");
                doc.OMaths[1].Range.Paragraphs[1].Range.Delete();
                if (installed)
                {
                    int emitted = 0;
                    Word.ApplicationEvents4_DocumentBeforeSaveEventHandler probe =
                        (Word.Document savedDoc, ref bool showUI, ref bool cancel) => { emitted++; };
                    var applicationEvents = (Word.ApplicationEvents4_Event)word;
                    applicationEvents.DocumentBeforeSave += probe;
                    try { doc.Save(); }
                    finally { applicationEvents.DocumentBeforeSave -= probe; }
                    Console.WriteLine("Mixed Save events observed: " + emitted + "; numbers " +
                        String.Join(",", SequenceFields(doc.Content).Select(f => f.Result.Text)));
                }
                else Equation.UpdateNumbers(doc);
                var sequence = SequenceFields(doc.Content);
                Check(sequence[0].Result.Text == "1" && sequence[1].Result.Text == "2",
                    "deleting Word equation renumbers both editors together");
            }
            finally
            {
                ((Word._Document)doc).Close(Word.WdSaveOptions.wdDoNotSaveChanges);
                ((Word._Document)fixture).Close(Word.WdSaveOptions.wdDoNotSaveChanges);
            }
        }

        private static Word.Field[] SequenceFields(Word.Range range)
        {
            return range.Fields.Cast<Word.Field>().Where(field => field.Type == Word.WdFieldType.wdFieldSequence).ToArray();
        }

        private static void SetPage(Word.Document doc)
        {
            doc.PageSetup.PaperSize = Word.WdPaperSize.wdPaperA4;
            doc.PageSetup.LeftMargin = 60;
            doc.PageSetup.RightMargin = 60;
        }

        private static Word.Range Insert(Word.Application app, Word.Document document, Word.Range at, string source,
            Layout layout, decimal size, string pattern = "({n})", string first = "")
        {
            return Equation.Insert(app, document, at, new EquationOptions(source, size, layout, pattern, first));
        }

        private static void Render(Word.Document doc, string folder, string label)
        {
            doc.ExportAsFixedFormat(Path.Combine(folder, label + ".pdf"), Word.WdExportFormat.wdExportFormatPDF);
            doc.SaveAs2(Path.Combine(folder, label + ".docx"), Word.WdSaveFormat.wdFormatXMLDocument);
        }
    }
}
