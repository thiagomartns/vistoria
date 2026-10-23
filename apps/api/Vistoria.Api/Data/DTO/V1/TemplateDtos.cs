using System.ComponentModel.DataAnnotations;
using Vistoria.Api.Model.Configurations;

namespace Vistoria.Api.Data.DTO.V1;

// Sem id nem version na raiz, como o UpsertClientDto (ADR 0028); rooms[].id e items[].id vão no corpo. As listas são
// completas e ficam na ordem enviada. Id e Position são nuláveis só para o [Required] pegar o campo ausente: não
// nuláveis, viriam Guid.Empty e 0 em silêncio.
public sealed record UpsertTemplateDto
{
    [Required(ErrorMessage = "Informe o nome.")]
    [StringLength(TemplateConfiguration.NameMaxLength, MinimumLength = TemplateConfiguration.NameMinLength,
        ErrorMessage = "O nome precisa ter de {2} a {1} caracteres.")]
    public string Name { get; init; } = "";

    [Required(ErrorMessage = "Informe os ambientes.")]
    [MaxLength(TemplateConfiguration.RoomsMax, ErrorMessage = "O roteiro pode ter até {1} ambientes.")]
    public List<UpsertTemplateRoomDto> Rooms { get; init; } = [];
}

public sealed record UpsertTemplateRoomDto
{
    [Required(ErrorMessage = "Informe o id do ambiente.")]
    public Guid? Id { get; init; }

    [Required(ErrorMessage = "Informe o nome do ambiente.")]
    [MaxLength(TemplateConfiguration.RoomNameMaxLength, ErrorMessage = "O nome do ambiente pode ter até {1} caracteres.")]
    public string Name { get; init; } = "";

    [Required(ErrorMessage = "Informe a posição do ambiente.")]
    [Range(0, int.MaxValue, ErrorMessage = "A posição não pode ser negativa.")]
    public int? Position { get; init; }

    [Required(ErrorMessage = "Informe os itens do ambiente.")]
    [MaxLength(TemplateConfiguration.ItemsMax, ErrorMessage = "O ambiente pode ter até {1} itens.")]
    public List<UpsertTemplateItemDto> Items { get; init; } = [];
}

public sealed record UpsertTemplateItemDto
{
    [Required(ErrorMessage = "Informe o id do item.")]
    public Guid? Id { get; init; }

    [Required(ErrorMessage = "Informe o nome do item.")]
    [MaxLength(TemplateConfiguration.ItemNameMaxLength, ErrorMessage = "O nome do item pode ter até {1} caracteres.")]
    public string Name { get; init; } = "";

    [Required(ErrorMessage = "Informe a posição do item.")]
    [Range(0, int.MaxValue, ErrorMessage = "A posição não pode ser negativa.")]
    public int? Position { get; init; }
}

/// <summary><c>version</c> é o mesmo base64 do <c>ETag</c>, sem aspas. Ambientes e itens na ordem gravada.</summary>
public sealed record TemplateDto(
    Guid Id,
    string Name,
    IReadOnlyList<TemplateRoomDto> Rooms,
    string Version,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record TemplateRoomDto(Guid Id, string Name, int Position, IReadOnlyList<TemplateItemDto> Items);

public sealed record TemplateItemDto(Guid Id, string Name, int Position);
