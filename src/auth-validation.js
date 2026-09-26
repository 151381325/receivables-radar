export function validatePasswordConfirmation(password, confirmation) {
  return password === confirmation ? '' : '两次输入的密码不一致';
}
