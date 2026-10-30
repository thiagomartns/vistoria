using System.ComponentModel.DataAnnotations;
using Vistoria.Api.Model.Configurations;

namespace Vistoria.Api.Data.DTO.V1;

public sealed record SignUpDto
{
    public const int PasswordMinLength = 8;
    public const int PasswordMaxLength = 128;

    [Required(ErrorMessage = "Informe o nome.")]
    [StringLength(UserConfiguration.NameMaxLength, MinimumLength = 2,
        ErrorMessage = "O nome precisa ter de {2} a {1} caracteres.")]
    public string Name { get; init; } = "";

    [Required(ErrorMessage = "Informe o e-mail.")]
    [MaxLength(UserConfiguration.EmailMaxLength, ErrorMessage = "O e-mail pode ter até {1} caracteres.")]
    [EmailAddress(ErrorMessage = "Informe um e-mail válido.")]
    public string Email { get; init; } = "";

    // Só comprimento, sem regra de composição; o teto limita o custo do PBKDF2 (backend.md, Autenticação).
    [Required(ErrorMessage = "Informe a senha.")]
    [StringLength(PasswordMaxLength, MinimumLength = PasswordMinLength,
        ErrorMessage = "A senha precisa ter de {2} a {1} caracteres.")]
    public string Password { get; init; } = "";
}

// Só presença e teto: formato e mínimo não importam para conferir uma senha, e o teto limita o custo do PBKDF2.
public sealed record SignInDto
{
    [Required(ErrorMessage = "Informe o e-mail.")]
    [MaxLength(UserConfiguration.EmailMaxLength, ErrorMessage = "O e-mail pode ter até {1} caracteres.")]
    public string Email { get; init; } = "";

    [Required(ErrorMessage = "Informe a senha.")]
    [MaxLength(SignUpDto.PasswordMaxLength, ErrorMessage = "A senha pode ter até {1} caracteres.")]
    public string Password { get; init; } = "";
}

public sealed record AuthUserDto(Guid Id, string Name);

public sealed record AuthDto(string AccessToken, DateTimeOffset ExpiresAt, AuthUserDto User);

public sealed record AccessTokenDto(string AccessToken, DateTimeOffset ExpiresAt);
