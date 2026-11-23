# jsdiff / diff 8.0.2

Source: https://github.com/kpdecker/jsdiff/tree/v8.0.2
Official npm package: https://registry.npmjs.org/diff/8.0.2
Tarball: https://registry.npmjs.org/diff/-/diff-8.0.2.tgz
License: BSD-3-Clause; see LICENSE.

Verified tarball integrity:
`sha512-sSuxWU5j5SR9QQji/o2qMvqRNYRDOcBTgsJ/DeCf4iSN4gW+gNMXM7wFIP+fdXZxoNiAnHUTGjCr+TSWXdRDKg==`

Vendored from the official package's libesm/diff/base.js and array.js.
The upstream directory keeps their original text. base.mjs is unchanged;
array.mjs only changes its local import extension to .mjs. The original
package metadata is retained in upstream-package.json. No npm installation,
CDN runtime, patch parser, or DOM/HTML parser is included.

EssayPilot's word-diff.mjs supplies lossless word, contraction, punctuation,
and whitespace tokens to diffArrays. It supplies size/edit/time limits, escapes
all output, and renders a supplemental always-visible, non-interactive comparison
(with a print modifier for print views). It does not use
an edit distance to infer a writing error, severity, quality, or score.
