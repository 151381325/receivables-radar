import nodemailer from 'nodemailer';

export function createMailer(smtpConfig, appOrigin) {
  const transport = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: { user: smtpConfig.user, pass: smtpConfig.pass },
  });

  return {
    async sendVerification({ email, token }) {
      const url = new URL('/verify-email', appOrigin);
      url.searchParams.set('token', token);
      await transport.sendMail({
        from: smtpConfig.from,
        to: email,
        subject: '验证你的回款雷达账号',
        text: `请在30分钟内打开以下链接完成邮箱验证：\n${url.href}`,
      });
    },
  };
}
