"use babel"

const _ = require("underscore-plus")
const {BufferedProcess, Range} = require("atom")

const {
  isSingleLineText,
  isLinewiseRange,
  limitNumber,
  toggleCaseForCharacter,
  splitTextByNewLine,
  splitArguments,
  getIndentLevelForBufferRow,
  adjustIndentWithKeepingLayout,
} = require("./utils")
const Base = require("./base")
const Operator = Base.getClass("Operator")

// TransformString
// ================================
class TransformString extends Operator {
  static stringTransformers = []
  trackChange = true
  stayOptionName = "stayOnTransformString"
  autoIndent = false
  autoIndentNewline = false
  autoIndentAfterInsertText = false

  static initClass(isCommand) {
    this.extend(isCommand)
  }

  static registerToSelectList() {
    this.stringTransformers.push(this)
  }

  mutateSelection(selection) {
    const text = this.getNewText(selection.getText(), selection)
    if (text) {
      let startRowIndentLevel
      if (this.autoIndentAfterInsertText) {
        const startRow = selection.getBufferRange().start.row
        startRowIndentLevel = getIndentLevelForBufferRow(this.editor, startRow)
      }
      let range = selection.insertText(text, {autoIndent: this.autoIndent, autoIndentNewline: this.autoIndentNewline})

      if (this.autoIndentAfterInsertText) {
        // Currently used by SplitArguments and Surround( linewise target only )
        if (this.target.isLinewise()) {
          range = range.translate([0, 0], [-1, 0])
        }
        this.editor.setIndentationForBufferRow(range.start.row, startRowIndentLevel)
        this.editor.setIndentationForBufferRow(range.end.row, startRowIndentLevel)
        // Adjust inner range, end.row is already( if needed ) translated so no need to re-translate.
        adjustIndentWithKeepingLayout(this.editor, range.translate([1, 0], [0, 0]))
      }
    }
  }
}
TransformString.initClass(false)

class ToggleCase extends TransformString {
  static displayName = "Toggle ~"

  getNewText(text) {
    return text.replace(/./g, toggleCaseForCharacter)
  }
}
ToggleCase.initClass()

class ToggleCaseAndMoveRight extends ToggleCase {
  flashTarget = false
  restorePositions = false
  target = "MoveRight"
}
ToggleCaseAndMoveRight.initClass()

class UpperCase extends TransformString {
  static displayName = "Upper"

  getNewText(text) {
    return text.toUpperCase()
  }
}
UpperCase.initClass()

class LowerCase extends TransformString {
  static displayName = "Lower"

  getNewText(text) {
    return text.toLowerCase()
  }
}
LowerCase.initClass()

// Replace
// -------------------------
class Replace extends TransformString {
  flashCheckpoint = "did-select-occurrence"
  input = null
  requireInput = true
  autoIndentNewline = true
  supportEarlySelect = true

  constructor(...args) {
    super(...args)
    this.onDidSelectTarget(() => this.focusInput({hideCursor: true}))
  }

  getNewText(text) {
    if (this.target.is("MoveRightBufferColumn") && text.length !== this.getCount()) {
      return
    }

    const input = this.input || "\n"
    if (input === "\n") {
      this.restorePositions = false
    }
    return text.replace(/./g, input)
  }
}
Replace.initClass()

class ReplaceCharacter extends Replace {
  target = "MoveRightBufferColumn"
}
ReplaceCharacter.initClass()

// -------------------------
// DUP meaning with SplitString need consolidate.
class SplitByCharacter extends TransformString {
  getNewText(text) {
    return text.split("").join(" ")
  }
}
SplitByCharacter.initClass()

class CamelCase extends TransformString {
  static displayName = "Camelize"
  getNewText(text) {
    return _.camelize(text)
  }
}
CamelCase.initClass()

class SnakeCase extends TransformString {
  static displayName = "Underscore _"
  getNewText(text) {
    return _.underscore(text)
  }
}
SnakeCase.initClass()

class PascalCase extends TransformString {
  static displayName = "Pascalize"
  getNewText(text) {
    return _.capitalize(_.camelize(text))
  }
}
PascalCase.initClass()

class DashCase extends TransformString {
  static displayName = "Dasherize -"
  getNewText(text) {
    return _.dasherize(text)
  }
}
DashCase.initClass()

class TitleCase extends TransformString {
  static displayName = "Titlize"
  getNewText(text) {
    return _.humanizeEventName(_.dasherize(text))
  }
}
TitleCase.initClass()

class EncodeUriComponent extends TransformString {
  static displayName = "Encode URI Component %"
  getNewText(text) {
    return encodeURIComponent(text)
  }
}
EncodeUriComponent.initClass()

class DecodeUriComponent extends TransformString {
  static displayName = "Decode URI Component %%"
  getNewText(text) {
    return decodeURIComponent(text)
  }
}
DecodeUriComponent.initClass()

class TrimString extends TransformString {
  static displayName = "Trim string"
  getNewText(text) {
    return text.trim()
  }
}
TrimString.initClass()

class CompactSpaces extends TransformString {
  static displayName = "Compact space"
  getNewText(text) {
    if (text.match(/^[ ]+$/)) {
      return " "
    } else {
      // Don't compact for leading and trailing white spaces.
      const regex = /^(\s*)(.*?)(\s*)$/gm
      return text.replace(regex, (m, leading, middle, trailing) => {
        return leading + middle.split(/[ \t]+/).join(" ") + trailing
      })
    }
  }
}
CompactSpaces.initClass()

class RemoveLeadingWhiteSpaces extends TransformString {
  wise = "linewise"
  getNewText(text, selection) {
    const trimLeft = text => text.trimLeft()
    return (
      splitTextByNewLine(text)
        .map(trimLeft)
        .join("\n") + "\n"
    )
  }
}
RemoveLeadingWhiteSpaces.initClass()

class ConvertToSoftTab extends TransformString {
  static displayName = "Soft Tab"
  wise = "linewise"

  mutateSelection(selection) {
    return this.scanForward(/\t/g, {scanRange: selection.getBufferRange()}, ({range, replace}) => {
      // Replace \t to spaces which length is vary depending on tabStop and tabLenght
      // So we directly consult it's screen representing length.
      const length = this.editor.screenRangeForBufferRange(range).getExtent().column
      return replace(" ".repeat(length))
    })
  }
}
ConvertToSoftTab.initClass()

class ConvertToHardTab extends TransformString {
  static displayName = "Hard Tab"

  mutateSelection(selection) {
    const tabLength = this.editor.getTabLength()
    this.scanForward(/[ \t]+/g, {scanRange: selection.getBufferRange()}, ({range, replace}) => {
      const {start, end} = this.editor.screenRangeForBufferRange(range)
      let startColumn = start.column
      const endColumn = end.column

      // We can't naively replace spaces to tab, we have to consider valid tabStop column
      // If nextTabStop column exceeds replacable range, we pad with spaces.
      let newText = ""
      while (true) {
        const remainder = startColumn % tabLength
        const nextTabStop = startColumn + (remainder === 0 ? tabLength : remainder)
        if (nextTabStop > endColumn) {
          newText += " ".repeat(endColumn - startColumn)
        } else {
          newText += "\t"
        }
        startColumn = nextTabStop
        if (startColumn >= endColumn) {
          break
        }
      }

      replace(newText)
    })
  }
}
ConvertToHardTab.initClass()

// -------------------------
class TransformStringByExternalCommand extends TransformString {
  autoIndent = true
  command = "" // e.g. command: 'sort'
  args = [] // e.g args: ['-rn']
  stdoutBySelection = null

  execute() {
    this.normalizeSelectionsIfNecessary()
    if (this.selectTarget()) {
      return new Promise(resolve => this.collect(resolve)).then(() => {
        for (const selection of this.editor.getSelections()) {
          const text = this.getNewText(selection.getText(), selection)
          selection.insertText(text, {autoIndent: this.autoIndent})
        }
        this.restoreCursorPositionsIfNecessary()
        this.activateMode(this.finalMode, this.finalSubmode)
      })
    }
  }

  collect(resolve) {
    this.stdoutBySelection = new Map()
    let processFinished = 0,
      processRunning = 0
    for (const selection of this.editor.getSelections()) {
      const {command, args} = this.getCommand(selection) || {}
      if (command == null || args == null) return

      processRunning++
      this.runExternalCommand({
        command: command,
        args: args,
        stdin: this.getStdin(selection),
        stdout: output => this.stdoutBySelection.set(selection, output),
        exit: code => {
          processFinished++
          if (processRunning === processFinished) resolve()
        },
      })
    }
  }

  runExternalCommand(options) {
    const {stdin} = options
    delete options.stdin
    const bufferedProcess = new BufferedProcess(options)
    bufferedProcess.onWillThrowError(({error, handle}) => {
      // Suppress command not found error intentionally.
      if (error.code === "ENOENT" && error.syscall.indexOf("spawn") === 0) {
        const commandName = this.constructor.getCommandName()
        console.log(`${commandName}: Failed to spawn command ${error.path}.`)
        handle()
      }
      this.cancelOperation()
    })

    if (stdin) {
      bufferedProcess.process.stdin.write(stdin)
      bufferedProcess.process.stdin.end()
    }
  }

  getNewText(text, selection) {
    return this.getStdout(selection) || text
  }

  // For easily extend by vmp plugin.
  getCommand(selection) {
    return {command: this.command, args: this.args}
  }
  getStdin(selection) {
    return selection.getText()
  }
  getStdout(selection) {
    return this.stdoutBySelection.get(selection)
  }
}
TransformStringByExternalCommand.initClass(false)

// -------------------------
class TransformStringBySelectList extends TransformString {
  static electListItems = null
  requireInput = true

  static getSelectListItems() {
    if (!this.selectListItems) {
      this.selectListItems = this.stringTransformers.map(klass => ({
        klass: klass,
        displayName: klass.hasOwnProperty("displayName")
          ? klass.displayName
          : _.humanizeEventName(_.dasherize(klass.name)),
      }))
    }
    return this.selectListItems
  }

  getItems() {
    return this.constructor.getSelectListItems()
  }

  constructor(...args) {
    super(...args)

    this.vimState.onDidConfirmSelectList(item => {
      const transformer = item.klass
      if (transformer.prototype.target) {
        this.target = transformer.prototype.target
      }
      this.vimState.reset()
      if (this.target) {
        this.vimState.operationStack.run(transformer, {target: this.target})
      } else {
        this.vimState.operationStack.run(transformer)
      }
    })

    this.focusSelectList({items: this.getItems()})
  }

  execute() {
    // NEVER be executed since operationStack is replaced with selected transformer
    throw new Error(`${this.name} should not be executed`)
  }
}
TransformStringBySelectList.initClass()

class TransformWordBySelectList extends TransformStringBySelectList {
  target = "InnerWord"
}
TransformWordBySelectList.initClass()

class TransformSmartWordBySelectList extends TransformStringBySelectList {
  target = "InnerSmartWord"
}
TransformSmartWordBySelectList.initClass()

// -------------------------
class ReplaceWithRegister extends TransformString {
  flashType = "operator-long"

  constructor(...args) {
    super(...args)
    this.vimState.sequentialPasteManager.onInitialize(this)
  }

  execute() {
    this.sequentialPaste = this.vimState.sequentialPasteManager.onExecute(this)

    super.execute()

    for (const selection of this.editor.getSelections()) {
      const range = this.vimState.mutationManager.getMutatedBufferRangeForSelection(selection)
      this.vimState.sequentialPasteManager.savePastedRangeForSelection(selection, range)
    }
  }

  getNewText(text, selection) {
    const value = this.vimState.register.get(null, selection, this.sequentialPaste)
    return value ? value.text : ""
  }
}
ReplaceWithRegister.initClass()

// Save text to register before replace
class SwapWithRegister extends TransformString {
  static initClass() {
    this.extend()
  }
  getNewText(text, selection) {
    const newText = this.vimState.register.getText()
    this.setTextToRegister(text, selection)
    return newText
  }
}
SwapWithRegister.initClass()

// Indent < TransformString
// -------------------------
class Indent extends TransformString {
  stayByMarker = true
  setToFirstCharacterOnLinewise = true
  wise = "linewise"

  mutateSelection(selection) {
    // Need count times indentation in visual-mode and its repeat(`.`).
    if (this.target.is("CurrentSelection")) {
      let oldText
      // limit to 100 to avoid freezing by accidental big number.
      const count = limitNumber(this.getCount(), {max: 100})
      this.countTimes(count, ({stop}) => {
        oldText = selection.getText()
        this.indent(selection)
        if (selection.getText() === oldText) stop()
      })
    } else {
      this.indent(selection)
    }
  }

  indent(selection) {
    selection.indentSelectedRows()
  }
}
Indent.initClass()

class Outdent extends Indent {
  indent(selection) {
    selection.outdentSelectedRows()
  }
}
Outdent.initClass()

class AutoIndent extends Indent {
  indent(selection) {
    selection.autoIndentSelectedRows()
  }
}
AutoIndent.initClass()

class ToggleLineComments extends TransformString {
  flashTarget = false
  stayByMarker = true
  wise = "linewise"

  mutateSelection(selection) {
    selection.toggleLineComments()
  }
}
ToggleLineComments.initClass()

class Reflow extends TransformString {
  mutateSelection(selection) {
    atom.commands.dispatch(this.editorElement, "autoflow:reflow-selection")
  }
}
Reflow.initClass()

class ReflowWithStay extends Reflow {
  stayAtSamePosition = true
}
ReflowWithStay.initClass()

// Surround < TransformString
// -------------------------
class SurroundBase extends TransformString {
  pairs = [["(", ")"], ["{", "}"], ["[", "]"], ["<", ">"]]
  pairsByAlias = {
    b: ["(", ")"],
    B: ["{", "}"],
    r: ["[", "]"],
    a: ["<", ">"],
  }

  pairCharsAllowForwarding = "[](){}"
  input = null
  requireInput = true
  supportEarlySelect = true // Experimental

  focusInputForSurroundChar() {
    this.focusInput({hideCursor: true})
  }

  focusInputForTargetPairChar() {
    this.focusInput({onConfirm: char => this.onConfirmTargetPairChar(char)})
  }

  getPair(char) {
    let pair
    return char in this.pairsByAlias
      ? this.pairsByAlias[char]
      : [...this.pairs, [char, char]].find(pair => pair.includes(char))
  }

  surround(text, char, {keepLayout = false} = {}) {
    let [open, close] = this.getPair(char)
    if (!keepLayout && text.endsWith("\n")) {
      this.autoIndentAfterInsertText = true
      open += "\n"
      close += "\n"
    }

    if (this.getConfig("charactersToAddSpaceOnSurround").includes(char) && isSingleLineText(text)) {
      text = " " + text + " "
    }

    return open + text + close
  }

  deleteSurround(text) {
    // Assume surrounding char is one-char length.
    const open = text[0]
    const close = text[text.length - 1]
    const innerText = text.slice(1, text.length - 1)
    return isSingleLineText(text) && open !== close ? innerText.trim() : innerText
  }

  onConfirmTargetPairChar(char) {
    this.setTarget(this.new("APair").assign({pair: this.getPair(char)}))
  }
}
SurroundBase.initClass(false)

class Surround extends SurroundBase {
  constructor(...args) {
    super(...args)
    this.onDidSelectTarget(() => this.focusInputForSurroundChar())
  }

  getNewText(text) {
    return this.surround(text, this.input)
  }
}
Surround.initClass()

class SurroundWord extends Surround {
  target = "InnerWord"
}
SurroundWord.initClass()

class SurroundSmartWord extends Surround {
  target = "InnerSmartWord"
}
SurroundSmartWord.initClass()

class MapSurround extends Surround {
  occurrence = true
  patternForOccurrence = /\w+/g
}
MapSurround.initClass()

// Delete Surround
// -------------------------
class DeleteSurround extends SurroundBase {
  init() {
    if (!this.target) {
      this.focusInputForTargetPairChar()
    }
    super.init()
  }

  onConfirmTargetPairChar(char) {
    super.onConfirmTargetPairChar(char)
    this.input = char
    this.processOperation()
  }

  getNewText(text) {
    return this.deleteSurround(text)
  }
}
DeleteSurround.initClass()

class DeleteSurroundAnyPair extends DeleteSurround {
  target = "AAnyPair"
  requireInput = false
}
DeleteSurroundAnyPair.initClass()

class DeleteSurroundAnyPairAllowForwarding extends DeleteSurroundAnyPair {
  target = "AAnyPairAllowForwarding"
}
DeleteSurroundAnyPairAllowForwarding.initClass()

// Change Surround
// -------------------------
class ChangeSurround extends SurroundBase {
  showDeleteCharOnHover() {
    const hoverPoint = this.vimState.mutationManager.getInitialPointForSelection(this.editor.getLastSelection())
    const char = this.editor.getSelectedText()[0]
    this.vimState.hover.set(char, hoverPoint)
  }

  constructor(...args) {
    super(...args)

    if (this.target) {
      this.onDidFailSelectTarget(() => this.abort())
    } else {
      this.onDidFailSelectTarget(() => this.cancelOperation())
      this.focusInputForTargetPairChar()
    }

    this.onDidSelectTarget(() => {
      this.showDeleteCharOnHover()
      this.focusInputForSurroundChar()
    })
  }

  getNewText(text) {
    const innerText = this.deleteSurround(text)
    return this.surround(innerText, this.input, {keepLayout: true})
  }
}
ChangeSurround.initClass()

class ChangeSurroundAnyPair extends ChangeSurround {
  target = "AAnyPair"
}
ChangeSurroundAnyPair.initClass()

class ChangeSurroundAnyPairAllowForwarding extends ChangeSurroundAnyPair {
  target = "AAnyPairAllowForwarding"
}
ChangeSurroundAnyPairAllowForwarding.initClass()

// -------------------------
// FIXME
// Currently native editor.joinLines() is better for cursor position setting
// So I use native methods for a meanwhile.
class Join extends TransformString {
  target = "MoveToRelativeLine"
  flashTarget = false
  restorePositions = false

  mutateSelection(selection) {
    const range = selection.getBufferRange()

    // When cursor is at last BUFFER row, it select last-buffer-row, then
    // joinning result in "clear last-buffer-row text".
    // I believe this is BUG of upstream atom-core. guard this situation here
    if (!range.isSingleLine() || range.end.row !== this.editor.getLastBufferRow()) {
      if (isLinewiseRange(range)) {
        selection.setBufferRange(range.translate([0, 0], [-1, Infinity]))
      }
      selection.joinLines()
    }
    const point = selection.getBufferRange().end.translate([0, -1])
    return selection.cursor.setBufferPosition(point)
  }
}
Join.initClass()

class JoinBase extends TransformString {
  wise = "linewise"
  trim = false
  target = "MoveToRelativeLineMinimumOne"

  init() {
    if (this.requireInput) {
      this.focusInput({charsMax: 10})
    }
    super.init()
  }

  getNewText(text) {
    const regex = this.trim ? /\r?\n[ \t]*/g : /\r?\n/g
    return text.trimRight().replace(regex, this.input) + "\n"
  }
}
JoinBase.initClass(false)

class JoinWithKeepingSpace extends JoinBase {
  input = ""
}
JoinWithKeepingSpace.initClass()

class JoinByInput extends JoinBase {
  requireInput = true
  trim = true
}
JoinByInput.initClass()

class JoinByInputWithKeepingSpace extends JoinByInput {
  trim = false
}
JoinByInputWithKeepingSpace.initClass()

// -------------------------
// String suffix in name is to avoid confusion with 'split' window.
class SplitString extends TransformString {
  requireInput = true
  input = null
  target = "MoveToRelativeLine"
  keepSplitter = false

  constructor(...args) {
    super(...args)
    this.onDidSetTarget(() => {
      this.focusInput({charsMax: 10})
    })
  }

  getNewText(text) {
    const input = this.input || "\\n"
    const regex = new RegExp(`${_.escapeRegExp(input)}`, "g")
    const lineSeparator = (this.keepSplitter ? this.input : "") + "\n"
    return text.replace(regex, lineSeparator)
  }
}
SplitString.initClass()

class SplitStringWithKeepingSplitter extends SplitString {
  keepSplitter = true
}
SplitStringWithKeepingSplitter.initClass()

class SplitArguments extends TransformString {
  keepSeparator = true
  autoIndentAfterInsertText = true

  getNewText(text) {
    const allTokens = splitArguments(text.trim())
    let newText = ""
    while (allTokens.length) {
      const {text, type} = allTokens.shift()
      newText += type === "separator" ? (this.keepSeparator ? text.trim() : "") + "\n" : text
    }
    return `\n${newText}\n`
  }
}
SplitArguments.initClass()

class SplitArgumentsWithRemoveSeparator extends SplitArguments {
  keepSeparator = false
}
SplitArgumentsWithRemoveSeparator.initClass()

class SplitArgumentsOfInnerAnyPair extends SplitArguments {
  target = "InnerAnyPair"
}
SplitArgumentsOfInnerAnyPair.initClass()

class ChangeOrder extends TransformString {
  getNewText(text) {
    return this.target.isLinewise()
      ? this.getNewList(splitTextByNewLine(text)).join("\n") + "\n"
      : this.sortArgumentsInTextBy(text, args => this.getNewList(args))
  }

  sortArgumentsInTextBy(text, fn) {
    const start = text.search(/\S/)
    const end = text.search(/\s*$/)
    const leadingSpaces = start !== -1 ? text.slice(0, start) : ""
    const trailingSpaces = end !== -1 ? text.slice(end) : ""
    const allTokens = splitArguments(text.slice(start, end))
    const args = allTokens.filter(token => token.type === "argument").map(token => token.text)
    const newArgs = fn(args)

    let newText = ""
    while (allTokens.length) {
      const token = allTokens.shift()
      // token.type is "separator" or "argument"
      newText += token.type === "separator" ? token.text : newArgs.shift()
    }
    return leadingSpaces + newText + trailingSpaces
  }
}
ChangeOrder.initClass(false)

class Reverse extends ChangeOrder {
  getNewList(rows) {
    return rows.reverse()
  }
}
Reverse.initClass()

class ReverseInnerAnyPair extends Reverse {
  target = "InnerAnyPair"
}
ReverseInnerAnyPair.initClass()

class Rotate extends ChangeOrder {
  backwards = false
  getNewList(rows) {
    if (this.backwards) rows.push(rows.shift())
    else rows.unshift(rows.pop())
    return rows
  }
}
Rotate.initClass()

class RotateBackwards extends ChangeOrder {
  backwards = true
}
RotateBackwards.initClass()

class RotateArgumentsOfInnerPair extends Rotate {
  target = "InnerAnyPair"
}
RotateArgumentsOfInnerPair.initClass()

class RotateArgumentsBackwardsOfInnerPair extends RotateArgumentsOfInnerPair {
  backwards = true
}
RotateArgumentsBackwardsOfInnerPair.initClass()

class Sort extends ChangeOrder {
  getNewList(rows) {
    return rows.sort()
  }
}
Sort.initClass()

class SortCaseInsensitively extends ChangeOrder {
  getNewList(rows) {
    return rows.sort((rowA, rowB) => rowA.localeCompare(rowB, {sensitivity: "base"}))
  }
}
SortCaseInsensitively.initClass()

class SortByNumber extends ChangeOrder {
  getNewList(rows) {
    return _.sortBy(rows, row => Number.parseInt(row) || Infinity)
  }
}
SortByNumber.initClass()

// prettier-ignore
const classesToRegisterToSelectList = [
  ToggleCase, UpperCase, LowerCase,
  Replace, SplitByCharacter,
  CamelCase, SnakeCase, PascalCase, DashCase, TitleCase,
  EncodeUriComponent, DecodeUriComponent,
  TrimString, CompactSpaces, RemoveLeadingWhiteSpaces,
  ConvertToSoftTab, ConvertToHardTab,
  JoinWithKeepingSpace, JoinByInput, JoinByInputWithKeepingSpace,
  SplitString, SplitStringWithKeepingSplitter,
  SplitArguments, SplitArgumentsWithRemoveSeparator, SplitArgumentsOfInnerAnyPair,
  Reverse, Rotate, RotateBackwards, Sort, SortCaseInsensitively, SortByNumber,
]
for (const klass of classesToRegisterToSelectList) {
  klass.registerToSelectList()
}