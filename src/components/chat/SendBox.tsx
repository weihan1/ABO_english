// src/components/chat/SendBox.tsx
import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip } from 'lucide-react';
import { isActionEnterKey, isComposingKeyboardEvent } from '../../core/keyboard';

interface SendBoxProps {
  onSend: (message: string, files?: File[]) => void;
  onStop?: () => void;
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function SendBox({ onSend, onStop, loading, disabled, placeholder }: SendBoxProps) {
  const [input, setInput] = useState('');
  const [isSingleLine, setIsSingleLine] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Smart detection: single-line vs multi-line
  useEffect(() => {
    if (input.includes('\n')) {
      setIsSingleLine(false);
      return;
    }
    // Auto switch to multi-line if > 800 chars
    if (input.length > 800) {
      setIsSingleLine(false);
      return;
    }
    // Measure text width
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx && textareaRef.current) {
      const style = getComputedStyle(textareaRef.current);
      ctx.font = `${style.fontSize} ${style.fontFamily}`;
      const width = ctx.measureText(input).width;
      const maxWidth = textareaRef.current.offsetWidth - 40;
      if (width > maxWidth && input.length > 50) {
        setIsSingleLine(false);
      }
    }
  }, [input]);

  // Auto-adjust height (max 300px)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 300)}px`;
  }, [input, isSingleLine]);

  // Keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isComposingKeyboardEvent(e)) return;

    // Enter to send (without Shift)
    if (isActionEnterKey(e) && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (input.trim() && !loading) {
        handleSend();
      }
      return;
    }

    // Shift+Enter or Ctrl/Cmd+Enter inserts newline
    if (isActionEnterKey(e) && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      setIsSingleLine(false);
    }
  };

  // Paste file upload support
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      setSelectedFiles((prev) => [...prev, ...files]);
    }
  };

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFiles((prev) => [...prev, ...Array.from(files)]);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Remove selected file
  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Send message
  const handleSend = () => {
    if (!input.trim() && selectedFiles.length === 0) return;
    onSend(input, selectedFiles.length > 0 ? selectedFiles : undefined);
    setInput('');
    setSelectedFiles([]);
    setIsSingleLine(true);
  };

  return (
    <div className="bg-white border border-[#E6DDF2] rounded-lg p-3 focus-within:border-[#D8B4E2] focus-within:ring-1 focus-within:ring-[#D8B4E2] transition-all">
      {/* Selected files preview */}
      {selectedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedFiles.map((file, index) => (
            <div
              key={index}
              className="flex items-center gap-1 px-2 py-1 bg-[#F5F3F7] rounded text-xs text-[#5B4A6E]"
            >
              <span className="truncate max-w-[120px]">{file.name}</span>
              <button
                onClick={() => removeFile(index)}
                className="text-[#9B8AA7] hover:text-[#5B4A6E]"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Paperclip button for file attachment */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2 rounded-md hover:bg-[#F5F3F7] text-[#9B8AA7] transition-colors shrink-0"
          disabled={disabled || loading}
          title="Attach file"
        >
          <Paperclip className="w-5 h-5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Input area - switches between single/multi line */}
        {isSingleLine ? (
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder || 'Type a message...'}
            disabled={disabled || loading}
            className="flex-1 bg-transparent px-2 py-2 text-[#3D2A4F] outline-none text-sm"
          />
        ) : (
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder || 'Type a message... (Shift+Enter for new line)'}
            disabled={disabled || loading}
            rows={1}
            className="flex-1 bg-transparent px-2 py-2 text-[#3D2A4F] outline-none text-sm resize-none min-h-[40px] max-h-[300px] overflow-y-auto"
          />
        )}

        {/* Send/Stop button */}
        {loading ? (
          <button
            onClick={onStop}
            className="p-2 rounded-md bg-red-50 text-red-500 hover:bg-red-100 transition-colors shrink-0"
            title="Stop"
          >
            <div className="w-5 h-5 rounded-sm bg-current" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={(!input.trim() && selectedFiles.length === 0) || disabled}
            className="p-2 rounded-md bg-[#7B5EA7] text-white hover:bg-[#6B4E97] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
            title="Send"
          >
            <Send className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Bottom hints */}
      <div className="flex justify-between mt-1 text-xs text-[#9B8AA7] px-1">
        <span>Enter to send, Shift+Enter for new line</span>
        <span>{input.length} characters</span>
      </div>
    </div>
  );
}
