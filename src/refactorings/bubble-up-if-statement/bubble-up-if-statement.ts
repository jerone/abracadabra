import { Editor, Code, ErrorReason } from "../../editor/editor";
import { Selection } from "../../editor/selection";
import * as t from "../../ast";

export { bubbleUpIfStatement, canBubbleUpIfStatement };

async function bubbleUpIfStatement(
  code: Code,
  selection: Selection,
  editor: Editor
) {
  const updatedCode = updateCode(t.parse(code), selection);

  if (!updatedCode.hasCodeChanged) {
    editor.showError(ErrorReason.DidNotFoundNestedIf);
    return;
  }

  await editor.write(updatedCode.code);
}

function canBubbleUpIfStatement(ast: t.AST, selection: Selection): boolean {
  return updateCode(ast, selection).hasCodeChanged;
}

function updateCode(ast: t.AST, selection: Selection): t.Transformed {
  return t.transformAST(ast, {
    IfStatement(path) {
      const { node } = path;

      if (!selection.isInsidePath(path)) return;

      // Since we visit nodes from parent to children, first check
      // if a child would match the selection closer.
      if (hasChildWhichMatchesSelection(path, selection)) return;

      const parentIfPath = t.findParentIfPath(path);
      if (!parentIfPath) return;

      if (t.isInAlternate(path)) {
        // We don't handle this scenario for now. It'd be an improvement.
        return;
      }

      const parentIf = parentIfPath.node;
      const parentTest = parentIf.test;
      const parentAlternate = parentIf.alternate;

      const buildNestedIfStatementFor = (node: t.Statement) =>
        buildNestedIfStatement(
          node,
          t.getPreviousSiblingStatements(path),
          t.getNextSiblingStatements(path),
          parentTest,
          parentAlternate
        );

      const newParentIfAlternate = node.alternate
        ? t.blockStatement([buildNestedIfStatementFor(node.alternate)])
        : t.hasSiblingStatement(path)
        ? t.blockStatement([buildNestedIfStatementFor(t.emptyStatement())])
        : parentIf.alternate;

      parentIfPath.replaceWith(
        t.ifStatement(node.test, parentIf.consequent, newParentIfAlternate)
      );
      parentIfPath.stop();

      path.replaceWith(buildNestedIfStatementFor(node.consequent));
      path.stop();

      path.getAllPrevSiblings().forEach(path => path.remove());
      path.getAllNextSiblings().forEach(path => path.remove());
    }
  });
}

function hasChildWhichMatchesSelection(
  path: t.NodePath,
  selection: Selection
): boolean {
  let result = false;

  path.traverse({
    IfStatement(childPath) {
      if (!selection.isInsidePath(childPath)) return;
      if (!t.findParentIfPath(childPath)) return;

      result = true;
      childPath.stop();
    }
  });

  return result;
}

function buildNestedIfStatement(
  branch: t.Statement,
  previousSiblingStatements: t.Statement[],
  nextSiblingStatements: t.Statement[],
  test: t.IfStatement["test"],
  alternate: t.IfStatement["alternate"]
): t.IfStatement {
  const body = t.isBlockStatement(branch) ? branch.body : [branch];

  return t.ifStatement(
    test,
    t.blockStatement([
      ...previousSiblingStatements,
      ...body,
      ...nextSiblingStatements
    ]),
    alternate
  );
}
