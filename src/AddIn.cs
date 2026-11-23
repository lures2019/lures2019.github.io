using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Extensibility;
using Microsoft.Office.Core;
using Word = Microsoft.Office.Interop.Word;

[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: ComVisible(false)]

namespace WordEquationTools
{
    [ComVisible(true)]
    [Guid("846B61EB-DF9D-4E60-BDB9-4D57AF1B4E18")]
    [ProgId("WordEquationTools.Connect")]
    [ClassInterface(ClassInterfaceType.AutoDispatch)]
    public sealed class Connect : IDTExtensibility2, IRibbonExtensibility
    {
        private Word.Application word;
        private Word.ApplicationEvents4_Event events;
        private Timer numberRefresh;
        private bool updating;
        private decimal size = 12;
        private Editor editor;
        private string pattern = "({n})";

        public void OnConnection(object application, ext_ConnectMode mode, object addIn, ref Array custom)
        {
            word = (Word.Application)application;
            AttachEvents();
        }

        private void AttachEvents()
        {
            DetachEvents();
            events = (Word.ApplicationEvents4_Event)word;
            events.DocumentBeforeSave += BeforeSave;
            events.WindowSelectionChange += SelectionChanged;
            numberRefresh = new Timer { Interval = 650 };
            numberRefresh.Tick += RefreshAfterSelectionChange;
        }

        public void OnDisconnection(ext_DisconnectMode mode, ref Array custom)
        {
            DetachEvents();
            word = null;
        }

        private void DetachEvents()
        {
            if (events != null)
            {
                events.DocumentBeforeSave -= BeforeSave;
                events.WindowSelectionChange -= SelectionChanged;
                events = null;
            }
            if (numberRefresh != null)
            {
                numberRefresh.Dispose();
                numberRefresh = null;
            }
        }

        public void OnAddInsUpdate(ref Array custom) {}
        public void OnStartupComplete(ref Array custom) { if (word != null) AttachEvents(); }
        public void OnBeginShutdown(ref Array custom) { DetachEvents(); }

        public string GetCustomUI(string ribbonId)
        {
            if (ribbonId != "Microsoft.Word.Document") return null;
            return @"<customUI xmlns=""http://schemas.microsoft.com/office/2009/07/customui"">
  <ribbon><tabs><tab id=""wfeTab"" label=""公式排版"">
    <group id=""wfeGroup"" label=""带编号公式"">
      <button id=""wfeInsert"" label=""插入公式"" size=""large""
        imageMso=""EquationInsertNew"" onAction=""InsertEquation""
        screentip=""插入 Word 或 MathType 公式"" supertip=""设置栏数、字号和自动编号格式。""/>
      <button id=""wfeUpdate"" label=""更新公式编号"" imageMso=""RefreshAll""
        onAction=""RefreshNumbers"" screentip=""更新本文档中由此插件插入的公式编号""/>
    </group>
  </tab></tabs></ribbon>
</customUI>";
        }

        public void InsertEquation(IRibbonControl control)
        {
            try
            {
                var doc = ActiveDocument();
                var location = word.Selection.Range.Duplicate;
                var paragraph = Equation.ValidateSelection(doc, location);
                EquationOptions pending = null;
                using (var form = new EquationDialog(word, doc, location, size, editor, pattern,
                    paragraph.Sections[1].PageSetup.TextColumns.Count))
                {
                    if (form.ShowFor(Owner()) == DialogResult.OK)
                    {
                        size = form.LastSize;
                        editor = form.LastEditor;
                        pattern = form.LastPattern;
                        pending = form.PendingMathType;
                    }
                }
                if (pending != null) Equation.Insert(word, doc, location, pending);
            }
            catch (InputException error) { ShowMessage(error.Message); }
            catch (COMException) { ShowMessage("Word 当前无法插入公式。请在正文中重新定位光标后再试。"); }
            catch (InvalidOperationException) { ShowMessage("未能创建公式段落。请移到一个空白正文段落后重试。"); }
        }

        public void RefreshNumbers(IRibbonControl control)
        {
            try
            {
                int count = Equation.UpdateNumbers(ActiveDocument());
                MessageBox.Show(Owner(), "已检查 " + count + " 个插件公式编号。", "公式排版",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (InputException error) { ShowMessage(error.Message); }
            catch (COMException) { ShowMessage("Word 当前无法刷新公式编号。"); }
        }

        private Word.Document ActiveDocument()
        {
            if (word == null || word.Documents.Count == 0) throw new InputException("请先打开一个可编辑的 Word 文档。");
            return word.ActiveDocument;
        }

        private WordWindow Owner() { return new WordWindow(word == null ? IntPtr.Zero : new IntPtr(word.ActiveWindow.Hwnd)); }

        private void ShowMessage(string text)
        {
            IWin32Window owner = word != null && word.Documents.Count > 0 ? Owner() : null;
            MessageBox.Show(owner, text, "公式排版", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void BeforeSave(Word.Document doc, ref bool saveAsUI, ref bool cancel)
        {
            if (updating) return;
            updating = true;
            try { Equation.UpdateNumbers(doc); }
            catch (COMException error) { Trace.WriteLine("WordEquationTools: update before save failed, HRESULT " + error.ErrorCode); }
            finally { updating = false; }
        }

        private void SelectionChanged(Word.Selection selection)
        {
            if (numberRefresh == null || updating) return;
            numberRefresh.Stop();
            numberRefresh.Start();
        }

        private void RefreshAfterSelectionChange(object sender, EventArgs args)
        {
            if (numberRefresh != null) numberRefresh.Stop();
            if (updating || word == null) return;
            updating = true;
            try
            {
                if (word.Documents.Count > 0)
                {
                    var doc = word.ActiveDocument;
                    if (!doc.Saved) Equation.UpdateNumbers(doc);
                }
            }
            catch (COMException error) { Trace.WriteLine("WordEquationTools: deferred numbering update failed, HRESULT " + error.ErrorCode); }
            finally { updating = false; }
        }
    }

    internal sealed class WordWindow : IWin32Window
    {
        internal WordWindow(IntPtr handle) { Handle = handle; }
        public IntPtr Handle { get; private set; }
    }
}
