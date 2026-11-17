<?php

declare(strict_types=1);

/** Render the transactional code email without remote assets or sign-in links. */
function accounts_code_email(string $code): array
{
    if (!preg_match('/^[0-9]{6}$/D', $code)) {
        throw new InvalidArgumentException('A six-digit sign-in code is required.');
    }

    $safeCode = htmlspecialchars($code, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $text = "Your sign-in code is: $code\n\nIt expires in 10 minutes and can be used once.\nIf you did not request it, you can ignore this email.\n";
    $html = <<<HTML
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
  <title>Your AustinGarrod.ca sign-in code</title>
  <style>
    @media only screen and (max-width: 480px) {
      .email-padding { padding: 24px 20px !important; }
      .email-heading { font-size: 28px !important; line-height: 34px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f8f9ff;color:#0b1c30;font-family:Inter,Arial,sans-serif;letter-spacing:0;-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;line-height:1px;color:#f8f9ff;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Your one-time sign-in code expires in 10 minutes.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f8f9ff" style="width:100%;border-collapse:collapse;background-color:#f8f9ff;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;border:1px solid #c6c6cd;border-collapse:collapse;background-color:#ffffff;">
          <tr>
            <td class="email-padding" style="padding:28px 32px;border-bottom:1px solid #c6c6cd;">
              <a href="https://austingarrod.ca/" style="color:#0b1c30;font-size:20px;font-weight:800;line-height:24px;text-decoration:none;letter-spacing:0;">AustinGarrod.ca</a>
            </td>
          </tr>
          <tr>
            <td class="email-padding" style="padding:32px;">
              <p style="margin:0 0 16px;color:#006a61;font-family:'JetBrains Mono',Consolas,'Courier New',monospace;font-size:12px;font-weight:700;line-height:18px;letter-spacing:0;">ACCOUNT ACCESS</p>
              <h1 class="email-heading" style="margin:0 0 16px;color:#0b1c30;font-family:Inter,Arial,sans-serif;font-size:32px;font-weight:700;line-height:39px;letter-spacing:0;">Your sign-in code.</h1>
              <p style="margin:0 0 24px;color:#45464d;font-size:16px;line-height:26px;">Enter this code in the browser where you requested it to sign in to your account.</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eff4ff" style="width:100%;border:1px solid #c6c6cd;border-collapse:collapse;background-color:#eff4ff;">
                <tr>
                  <td style="padding:24px;">
                    <p style="margin:0 0 8px;color:#006a61;font-family:'JetBrains Mono',Consolas,'Courier New',monospace;font-size:12px;font-weight:700;line-height:18px;letter-spacing:0;">ONE-TIME CODE</p>
                    <p dir="ltr" style="margin:0;color:#000000;font-family:'JetBrains Mono',Consolas,'Courier New',monospace;font-size:40px;font-weight:700;line-height:48px;letter-spacing:0;">{$safeCode}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;color:#45464d;font-size:14px;line-height:23px;">This code expires in <strong style="color:#0b1c30;font-weight:700;">10 minutes</strong> and can be used once. Keep it private.</p>
            </td>
          </tr>
          <tr>
            <td class="email-padding" style="padding:24px 32px;border-top:1px solid #c6c6cd;">
              <p style="margin:0 0 12px;color:#45464d;font-size:14px;line-height:23px;">If you did not request this code, you can ignore this email.</p>
              <p style="margin:0;color:#45464d;font-size:12px;line-height:20px;">AustinGarrod.ca &nbsp;&middot;&nbsp; <a href="https://austingarrod.ca/account/privacy/" style="color:#006a61;text-decoration:underline;">Account privacy</a></p>
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>
HTML;

    return ['html' => $html, 'text' => $text];
}
