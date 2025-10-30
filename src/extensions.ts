import * as vscode from 'vscode';
import { Minimatch } from 'minimatch';

type Config = {
  maxLines: number;
  languagesAllowlist: string[];
  pathAllowlist: string[];
  showInfoMessage: boolean;
  debugMode: boolean;
  maxLinesOverrides: Record<string, number>;
};

let bypassOnce = false;
let processingDocument: vscode.Uri | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('LineLimitBlocker: Extension activated!');

  // デバッグログ関数
  const debugLog = (...args: any[]) => {
    const cfg = getConfig();
    if (cfg.debugMode) {
      console.log('LineLimitBlocker:', ...args);
    }
  };

  const getConfig = (): Config => {
    const cfg = vscode.workspace.getConfiguration('lineLimitBlocker');
    return {
      maxLines: cfg.get('maxLines', 1000),
      languagesAllowlist: cfg.get('languagesAllowlist', []),
      pathAllowlist: cfg.get('pathAllowlist', []),
      showInfoMessage: cfg.get('showInfoMessage', true),
      debugMode: cfg.get('debugMode', false),
      maxLinesOverrides: cfg.get('maxLinesOverrides', {})
    };
  };

  const getAllowMatchers = () => getConfig().pathAllowlist.map(p => new Minimatch(p));

  /*
   * ファイルパスに対して適用される maxLines 値を取得する
   * maxLinesOverrides でマッチするパターンがあればその値を返し、なければデフォルトの maxLines を返す
   */
  const getMaxLinesForPath = (filePath: string): number => {
    const cfg = getConfig();

    // maxLinesOverrides をチェック
    for (const [pattern, maxLines] of Object.entries(cfg.maxLinesOverrides)) {
      const matcher = new Minimatch(pattern);
      if (matcher.match(filePath)) {
        debugLog(`File matches override pattern "${pattern}", using maxLines: ${maxLines}`);
        return maxLines;
      }
    }

    // デフォルト値を返す
    return cfg.maxLines;
  };

  async function checkAndClose(doc: vscode.TextDocument) {
    debugLog('checkAndClose called for:', doc.uri.fsPath, 'lineCount:', doc.lineCount);

    // 処理中のドキュメントの場合はスキップ
    if (processingDocument && doc.uri.toString() === processingDocument.toString()) {
      debugLog('Currently processing this document, skipping to avoid loop');
      return;
    }

    if (bypassOnce) {
      debugLog('bypassOnce is true, skipping');
      bypassOnce = false;
      return;
    }
    if (doc.isUntitled) {
      debugLog('Document is untitled, skipping');
      return;
    }

    const cfg = getConfig();
    debugLog('Config:', cfg);
    const filePath = doc.uri.fsPath || doc.uri.path;

    // パス許可リスト
    for (const mm of getAllowMatchers()) {
      if (mm.match(filePath)) {
        debugLog('File matches path allowlist, skipping');
        return;
      }
    }

    // 言語許可リスト
    if (cfg.languagesAllowlist.includes(doc.languageId)) {
      debugLog('Language in allowlist, skipping');
      return;
    }

    // 行数チェック（パターンマッチングによるオーバーライドを適用）
    const maxLines = getMaxLinesForPath(filePath);
    debugLog(`Checking line count: ${doc.lineCount} <= ${maxLines}?`);
    if (doc.lineCount <= maxLines) {
      debugLog('File within line limit, allowing');
      return;
    }

    // タブを閉じる
    debugLog('Line limit exceeded, attempting to close tab');
    debugLog('Tab groups count:', vscode.window.tabGroups.all.length);

    for (const group of vscode.window.tabGroups.all) {
      debugLog('Checking tab group:', group.viewColumn, 'tabs:', group.tabs.length);

      // デバッグ用：すべてのタブの情報を出力
      for (const tab of group.tabs) {
        const tabUri = tab.input && ((tab.input as any).uri ?? (tab.input as any).resource);
        debugLog(`Tab "${tab.label}" URI:`, tabUri?.toString());
      }

      const tab = group.tabs.find(t => t.input && isSameDoc(t.input, doc, debugLog));
      if (tab) {
        debugLog('Found tab to close:', tab.label);
        try {
          await vscode.window.tabGroups.close(tab, true);
          debugLog('Tab closed successfully');

          // タブクローズ後に少し待機（VS Codeの内部状態更新のため）
          await new Promise(resolve => setTimeout(resolve, 100));

          if (cfg.showInfoMessage) {
            vscode.window.showWarningMessage(
              `LineLimitBlocker: '${basename(filePath)}' は ${doc.lineCount} 行あり、上限 (${maxLines}) を超えています。`,
              '次の1回だけ許可'
            ).then(async (action) => {
              if (action) {
                bypassOnce = true;
                processingDocument = doc.uri;
                try {
                  await vscode.window.showTextDocument(doc, { preview: true });
                } catch (error) {
                  console.error('LineLimitBlocker: ドキュメントの表示に失敗しました:', error);
                  vscode.window.showErrorMessage(`LineLimitBlocker: ファイルを開く際にエラーが発生しました: ${error}`);
                } finally {
                  processingDocument = null;
                }
              }
            });
          }
        } catch (error) {
          console.error('LineLimitBlocker: タブのクローズに失敗しました:', error);
          if (cfg.showInfoMessage) {
            vscode.window.showErrorMessage(`LineLimitBlocker: ファイルを閉じる際にエラーが発生しました: ${error}`);
          }
        }
        return;
      }
    }
    debugLog('No tab found to close - this might be the issue!');
  }

  // 既に開いているファイルをチェック
  vscode.workspace.textDocuments.forEach(checkAndClose);

  // 新しく開かれたドキュメントを監視
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((doc) => {
    debugLog('onDidOpenTextDocument triggered for:', doc.uri.fsPath);
    checkAndClose(doc);
  }));

  // アクティブなエディタが変更されたときも監視
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && editor.document) {
      debugLog('onDidChangeActiveTextEditor triggered for:', editor.document.uri.fsPath);
      checkAndClose(editor.document);
    }
  }));

  // 可視エディタが変更されたときも監視
  context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors((editors) => {
    debugLog('onDidChangeVisibleTextEditors triggered, editor count:', editors.length);
    for (const editor of editors) {
      if (editor.document) {
        checkAndClose(editor.document);
      }
    }
  }));

  // 次回1回だけ許可するコマンド
  context.subscriptions.push(vscode.commands.registerCommand('lineLimitBlocker.openAnywayOnce', () => {
    bypassOnce = true;
    vscode.window.showInformationMessage('LineLimitBlocker: 次の1回だけ開くことを許可します。');
  }));
}

function isSameDoc(input: vscode.TabInputText | vscode.TabInputCustom | vscode.TabInputNotebook | vscode.TabInputNotebookDiff | vscode.TabInputTerminal | vscode.TabInputTextDiff | vscode.TabInputWebview | unknown, doc: vscode.TextDocument, debugLog: (...args: any[]) => void): boolean {
  if (!input || typeof input !== 'object') return false;

  // TabInputTextまたはTabInputCustomの場合
  const uri = (input as any).uri ?? (input as any).resource;
  const isSame = uri?.toString() === doc.uri.toString();

  // デバッグ用
  if (uri) {
    debugLog(`Comparing URIs - Tab: "${uri.toString()}" vs Doc: "${doc.uri.toString()}" - Match: ${isSame}`);
  }

  return isSame;
}

function basename(p: string) {
  return p.replace(/\\/g, '/').split('/').pop() ?? p;
}

export function deactivate() {}