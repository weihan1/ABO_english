import { useState } from 'react';
import { CheckCircle, XCircle, Loader2, RefreshCw, Globe } from 'lucide-react';
import { api } from '../../core/api';
import type { CookieValidationResult } from '../../types/module';

interface CookieValidatorProps {
  moduleId: string;
  initialCookie?: string;
  onValidationChange?: (result: CookieValidationResult | null) => void;
  onCookieChange?: (cookie: string) => void;
}

export function CookieValidator({
  moduleId,
  initialCookie = '',
  onValidationChange,
  onCookieChange,
}: CookieValidatorProps) {
  const [cookie, setCookie] = useState(initialCookie);
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<CookieValidationResult | null>(null);
  const [isGettingFromBrowser, setIsGettingFromBrowser] = useState(false);

  const validateCookie = async () => {
    if (!cookie.trim()) {
      const result: CookieValidationResult = {
        valid: false,
        message: 'Cookie cannot be empty',
      };
      setValidationResult(result);
      onValidationChange?.(result);
      return;
    }

    setIsValidating(true);
    try {
      const result = await api.post<CookieValidationResult>(
        `/api/modules/${moduleId}/validate-cookie`,
        { cookie: cookie.trim() }
      );
      setValidationResult(result);
      onValidationChange?.(result);
    } catch (err) {
      const result: CookieValidationResult = {
        valid: false,
        message: err instanceof Error ? err.message : 'Validation failed',
      };
      setValidationResult(result);
      onValidationChange?.(result);
    } finally {
      setIsValidating(false);
    }
  };

  const getCookieFromBrowser = async () => {
    setIsGettingFromBrowser(true);
    try {
      // Try to get cookie from browser extension or clipboard
      const result = await api.post<{ cookie: string; source: string }>(
        `/api/modules/${moduleId}/get-cookie`,
        {}
      );
      setCookie(result.cookie);
      onCookieChange?.(result.cookie);

      // Auto-validate after getting cookie
      const validationResult = await api.post<CookieValidationResult>(
        `/api/modules/${moduleId}/validate-cookie`,
        { cookie: result.cookie }
      );
      setValidationResult(validationResult);
      onValidationChange?.(validationResult);
    } catch (err) {
      // Fallback: try to read from clipboard
      try {
        const clipboardText = await navigator.clipboard.readText();
        if (clipboardText.includes('=') && clipboardText.length > 50) {
          setCookie(clipboardText.trim());
          onCookieChange?.(clipboardText.trim());

          const validationResult = await api.post<CookieValidationResult>(
            `/api/modules/${moduleId}/validate-cookie`,
            { cookie: clipboardText.trim() }
          );
          setValidationResult(validationResult);
          onValidationChange?.(validationResult);
        } else {
          throw new Error('No valid cookie in the clipboard');
        }
      } catch (clipboardErr) {
        const result: CookieValidationResult = {
          valid: false,
          message: 'Could not fetch the cookie automatically. Please paste it into the input manually.',
        };
        setValidationResult(result);
        onValidationChange?.(result);
      }
    } finally {
      setIsGettingFromBrowser(false);
    }
  };

  const handleCookieChange = (value: string) => {
    setCookie(value);
    onCookieChange?.(value);
    // Clear validation result when cookie changes
    if (validationResult) {
      setValidationResult(null);
      onValidationChange?.(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Cookie Input */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Cookie
        </label>
        <textarea
          value={cookie}
          onChange={(e) => handleCookieChange(e.target.value)}
          placeholder="Enter the cookie string..."
          rows={3}
          className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button
          onClick={getCookieFromBrowser}
          disabled={isGettingFromBrowser}
          className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isGettingFromBrowser ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Globe className="w-4 h-4" />
          )}
          Get from browser
        </button>
        <button
          onClick={validateCookie}
          disabled={isValidating || !cookie.trim()}
          className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isValidating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Validate
        </button>
      </div>

      {/* Validation Result */}
      {validationResult && (
        <div
          className={`p-3 rounded-lg flex items-start gap-3 ${
            validationResult.valid
              ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
          }`}
        >
          {validationResult.valid ? (
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <p
              className={`text-sm font-medium ${
                validationResult.valid
                  ? 'text-green-800 dark:text-green-200'
                  : 'text-red-800 dark:text-red-200'
              }`}
            >
              {validationResult.valid ? 'Cookie valid' : 'Cookie invalid'}
            </p>
            <p
              className={`text-xs mt-1 ${
                validationResult.valid
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {validationResult.message}
            </p>
            {validationResult.expiryDate && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                Expires: {new Date(validationResult.expiryDate).toLocaleString('en-US')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Help Text */}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Tip: log in to the target site, open the browser dev tools (F12) → Application → Cookies, and copy the relevant cookie value.
      </p>
    </div>
  );
}
