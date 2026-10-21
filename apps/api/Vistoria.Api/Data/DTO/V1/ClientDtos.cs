using System.ComponentModel.DataAnnotations;
using Vistoria.Api.Infrastructure.Validation;
using Vistoria.Api.Model.Configurations;

namespace Vistoria.Api.Data.DTO.V1;

// Sem id nem version: o id vem da rota e a versão-base do If-Match (ADR 0028). Um id no corpo é ignorado, como
// qualquer campo desconhecido, então o front pode mandar o registro local inteiro.
public sealed record UpsertClientDto
{
    [Required(ErrorMessage = "Informe o nome.")]
    [StringLength(ClientConfiguration.NameMaxLength, MinimumLength = ClientConfiguration.NameMinLength,
        ErrorMessage = "O nome precisa ter de {2} a {1} caracteres.")]
    public string Name { get; init; } = "";

    [CpfCnpj]
    public string? Document { get; init; }

    [MaxLength(UserConfiguration.EmailMaxLength, ErrorMessage = "O e-mail pode ter até {1} caracteres.")]
    [EmailAddress(ErrorMessage = "Informe um e-mail válido.")]
    public string? Email { get; init; }

    [MaxLength(ClientConfiguration.PhoneMaxLength, ErrorMessage = "O telefone pode ter até {1} caracteres.")]
    public string? Phone { get; init; }
}

/// <summary><c>version</c> é o mesmo base64 do <c>ETag</c>, sem aspas.</summary>
public sealed record ClientDto(
    Guid Id,
    string Name,
    string? Document,
    string? Email,
    string? Phone,
    string Version,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
