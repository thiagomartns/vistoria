namespace Vistoria.Api.Model;

/// <summary>
/// Conta de quem usa o app. Entidade de autenticação, não do domínio: não herda de <c>SyncEntity</c> e nunca
/// sincroniza, porque guarda o hash da senha (ADR 0026).
/// </summary>
public class User
{
    public Guid Id { get; set; }                  // UUID v7, gerado no servidor no cadastro
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";       // normalizado: ver NormalizeEmail
    public string PasswordHash { get; set; } = ""; // PasswordHasher<User> (PBKDF2 com salt)
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>E-mail único sem diferenciar maiúsculas, independente do collation do banco.</summary>
    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();
}
