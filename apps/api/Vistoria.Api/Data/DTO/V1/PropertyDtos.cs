using System.ComponentModel.DataAnnotations;
using Vistoria.Api.Infrastructure.Validation;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Configurations;

namespace Vistoria.Api.Data.DTO.V1;

// Sem id nem version, como o UpsertClientDto (ADR 0028). ClientId e Type são nuláveis só para o [Required] pegar o
// campo ausente: não nuláveis, viriam Guid.Empty e Apartment em silêncio.
public sealed record UpsertPropertyDto
{
    [Required(ErrorMessage = "Informe o cliente.")]
    public Guid? ClientId { get; init; }

    [Required(ErrorMessage = "Informe a rua.")]
    [MaxLength(PropertyConfiguration.StreetMaxLength, ErrorMessage = "A rua pode ter até {1} caracteres.")]
    public string Street { get; init; } = "";

    [Required(ErrorMessage = "Informe o número (ou s/n).")]
    [MaxLength(PropertyConfiguration.NumberMaxLength, ErrorMessage = "O número pode ter até {1} caracteres.")]
    public string Number { get; init; } = "";

    [MaxLength(PropertyConfiguration.ComplementMaxLength, ErrorMessage = "O complemento pode ter até {1} caracteres.")]
    public string? Complement { get; init; }

    [Required(ErrorMessage = "Informe o bairro.")]
    [MaxLength(PropertyConfiguration.DistrictMaxLength, ErrorMessage = "O bairro pode ter até {1} caracteres.")]
    public string District { get; init; } = "";

    [Required(ErrorMessage = "Informe a cidade.")]
    [MaxLength(PropertyConfiguration.CityMaxLength, ErrorMessage = "A cidade pode ter até {1} caracteres.")]
    public string City { get; init; } = "";

    [Required(ErrorMessage = "Informe a UF.")]
    [Uf]
    public string State { get; init; } = "";

    // [0-9], não \d: no .NET o \d aceita dígitos de qualquer escrita Unicode.
    [Required(ErrorMessage = "Informe o CEP.")]
    [RegularExpression("^[0-9]{8}$", ErrorMessage = "Informe o CEP com 8 dígitos, sem hífen.")]
    public string ZipCode { get; init; } = "";

    [Required(ErrorMessage = "Informe o tipo do imóvel.")]
    public PropertyType? Type { get; init; }

    [MaxLength(PropertyConfiguration.NotesMaxLength, ErrorMessage = "As observações podem ter até {1} caracteres.")]
    public string? Notes { get; init; }
}

/// <summary><c>version</c> é o mesmo base64 do <c>ETag</c>, sem aspas.</summary>
public sealed record PropertyDto(
    Guid Id,
    Guid ClientId,
    string Street,
    string Number,
    string? Complement,
    string District,
    string City,
    string State,
    string ZipCode,
    PropertyType Type,
    string? Notes,
    string Version,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
