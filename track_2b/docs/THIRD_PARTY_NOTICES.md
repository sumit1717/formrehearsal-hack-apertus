# Third-party notices

HackApertus template source: https://github.com/HackApertus/project-template/tree/7f2382275461baf3fa6c8855d157d86abffe9f0e . Its challenge text is retained in [CHALLENGE_TEMPLATE.md](../CHALLENGE_TEMPLATE.md); report headings are adapted in [the scaffold](../technical_report.md). Preserve [its Apache License 2.0 text](licenses/HackApertus-template-APACHE-2.0.txt) for template material. The pinned source contained no separate NOTICE file. Its report also names CC-BY-4.0; the original-project licensing is separately scoped in the root LICENSE_POLICY.md.

Locked `survey-core` 3.1.2 declares MIT. The container installs its unmodified package and retains its package notices. Node/Alpine has separate component licenses; keep distributed image/package notices. No Playwright/test dependencies are included in the runtime image.

Original-project grants are defined separately by the root LICENSE_POLICY.md and DATA_LICENSES.json. They do not replace third-party notices. Earlier private development was independently created and later aligned with the template. The public release repository was separately generated from the official template, with initial commit b59520fe9ad216fbb891fa695369851220458ff1 and tree 2d5642aa258364395f3ebd3f1e120912efd2958f, matching template source commit 09f8e9e2b588db3325869b23c6d5132f5c3756f7. Historical template-source attribution above is preserved.

## Supplemental dependency and typography attribution

These notices identify third-party material only; any original-project licensing is separately stated in the root LICENSE_POLICY.md.

### SurveyJS Form Library

The integrity-locked `survey-core` 3.1.2 npm package declares MIT. Its distributed JavaScript headers retain “Copyright (c) 2015-2026 Devsoft Baltic OÜ” and link the MIT license. The verified tarball contains no standalone LICENSE/NOTICE/COPYING file. A complete, unmodified [upstream v3.1.2 MIT license](#surveyjs-mit-license-text) is therefore supplied with this source package. That upstream license file has the 2015-2025 copyright range; both original notices are preserved, without silently changing either date.

Primary sources: [versioned license](https://github.com/surveyjs/survey-library/blob/v3.1.2/LICENSE), [exact npm distribution](https://registry.npmjs.org/survey-core/-/survey-core-3.1.2.tgz), and [Form Library licensing](https://surveyjs.io/form-library/documentation/overview). The separately licensed Survey Creator is not a project dependency. This package does not redistribute installed node_modules; the container recipe installs the unchanged locked package. If distributing a standalone built image later, include all applicable package/image notices with that distribution too.

### Report and walkthrough fonts

The accepted report embeds subsets of DejaVu Sans and DejaVu Sans Bold. Its Helvetica and Courier references are not embedded font programs. The walkthrough generator uses DejaVu Sans, Bold and Mono to render text into image frames. The companion [DejaVu Sans notice](#dejavu-sans-font-notice-text) retains Bitstream/Arev notices; DejaVu changes are public domain. See the [upstream license](https://dejavu-fonts.github.io/License.html).

The accepted PDF already retains copyright nameID 0 and full Bitstream/Arev licensing nameID 13 inside both embedded DejaVu font subsets. This companion notice improves discoverability; it is not a repair of missing embedded notices. This is conservative companion attribution for the actual fonts, not a claim that rasterized video text is a redistribution of font software, that every embedded document needs an additional visible copyright line, or that the accepted report/video is unlawful. It adds no text to or modification of those binary artifacts. Font terms apply to the relevant font software; they do not automatically license the report or video content.

## SurveyJS MIT license text

MIT License

Copyright (c) 2015-2025 Devsoft Baltic OÜ - http://surveyjs.io/

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## DejaVu Sans font notice text

Fonts are (c) Bitstream (see below). DejaVu changes are in public domain. Glyphs imported from Arev fonts are (c) Tavmjung Bah (see below)

Bitstream Vera Fonts Copyright
------------------------------

Copyright (c) 2003 by Bitstream, Inc. All Rights Reserved. Bitstream Vera is
a trademark of Bitstream, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of the fonts accompanying this license ("Fonts") and associated
documentation files (the "Font Software"), to reproduce and distribute the
Font Software, including without limitation the rights to use, copy, merge,
publish, distribute, and/or sell copies of the Font Software, and to permit
persons to whom the Font Software is furnished to do so, subject to the
following conditions:

The above copyright and trademark notices and this permission notice shall
be included in all copies of one or more of the Font Software typefaces.

The Font Software may be modified, altered, or added to, and in particular
the designs of glyphs or characters in the Fonts may be modified and
additional glyphs or characters may be added to the Fonts, only if the fonts
are renamed to names not containing either the words "Bitstream" or the word
"Vera".

This License becomes null and void to the extent applicable to Fonts or Font
Software that has been modified and is distributed under the "Bitstream
Vera" names.

The Font Software may be sold as part of a larger software package but no
copy of one or more of the Font Software typefaces may be sold by itself.

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT,
TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL BITSTREAM OR THE GNOME
FOUNDATION BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING
ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF
THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE
FONT SOFTWARE.

Except as contained in this notice, the names of Gnome, the Gnome
Foundation, and Bitstream Inc., shall not be used in advertising or
otherwise to promote the sale, use or other dealings in this Font Software
without prior written authorization from the Gnome Foundation or Bitstream
Inc., respectively. For further information, contact: fonts at gnome dot
org. 

Arev Fonts Copyright
------------------------------

Copyright (c) 2006 by Tavmjong Bah. All Rights Reserved.

Permission is hereby granted, free of charge, to any person obtaining
a copy of the fonts accompanying this license ("Fonts") and
associated documentation files (the "Font Software"), to reproduce
and distribute the modifications to the Bitstream Vera Font Software,
including without limitation the rights to use, copy, merge, publish,
distribute, and/or sell copies of the Font Software, and to permit
persons to whom the Font Software is furnished to do so, subject to
the following conditions:

The above copyright and trademark notices and this permission notice
shall be included in all copies of one or more of the Font Software
typefaces.

The Font Software may be modified, altered, or added to, and in
particular the designs of glyphs or characters in the Fonts may be
modified and additional glyphs or characters may be added to the
Fonts, only if the fonts are renamed to names not containing either
the words "Tavmjong Bah" or the word "Arev".

This License becomes null and void to the extent applicable to Fonts
or Font Software that has been modified and is distributed under the 
"Tavmjong Bah Arev" names.

The Font Software may be sold as part of a larger software package but
no copy of one or more of the Font Software typefaces may be sold by
itself.

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL
TAVMJONG BAH BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.

Except as contained in this notice, the name of Tavmjong Bah shall not
be used in advertising or otherwise to promote the sale, use or other
dealings in this Font Software without prior written authorization
from Tavmjong Bah. For further information, contact: tavmjong @ free
. fr.
