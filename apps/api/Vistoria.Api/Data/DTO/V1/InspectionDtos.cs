using System.ComponentModel.DataAnnotations;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Configurations;

namespace Vistoria.Api.Data.DTO.V1;

// Sem id nem version na raiz, como o UpsertClientDto (ADR 0028); rooms[].id e items[].id vão no corpo, e as listas são
// completas: o que não vier é excluído. Nada do que o servidor define entra aqui (completedAt, nem os campos de
// referência da saída): no corpo, são ignorados como qualquer campo desconhecido. Os nuláveis com [Required] são só
// para pegar o campo ausente: não nuláveis, viriam Guid.Empty, 0 ou o primeiro valor do enum em silêncio.
public sealed record UpsertInspectionDto
{
    [Required(ErrorMessage = "Informe o imóvel.")]
    public Guid? PropertyId { get; init; }

    [Required(ErrorMessage = "Informe se a vistoria é de entrada ou de saída.")]
    public InspectionKind? Kind { get; init; }

    [Required(ErrorMessage = "Informe a situação da vistoria.")]
    public InspectionStatus? Status { get; init; }

    [Required(ErrorMessage = "Informe o início da vistoria.")]
    public DateTimeOffset? StartedAt { get; init; }

    [MaxLength(InspectionConfiguration.GeneralNotesMaxLength,
        ErrorMessage = "As observações gerais podem ter até {1} caracteres.")]
    public string? GeneralNotes { get; init; }

    [Required(ErrorMessage = "Informe os ambientes.")]
    [MaxLength(InspectionConfiguration.RoomsMax, ErrorMessage = "A vistoria pode ter até {1} ambientes.")]
    public List<UpsertRoomDto> Rooms { get; init; } = [];
}

public sealed record UpsertRoomDto
{
    [Required(ErrorMessage = "Informe o id do ambiente.")]
    public Guid? Id { get; init; }

    [Required(ErrorMessage = "Informe o nome do ambiente.")]
    [StringLength(RoomConfiguration.NameMaxLength, MinimumLength = RoomConfiguration.NameMinLength,
        ErrorMessage = "O nome do ambiente precisa ter de {2} a {1} caracteres.")]
    public string Name { get; init; } = "";

    [Required(ErrorMessage = "Informe a posição do ambiente.")]
    [Range(0, int.MaxValue, ErrorMessage = "A posição não pode ser negativa.")]
    public int? Position { get; init; }

    [MaxLength(RoomConfiguration.NotesMaxLength, ErrorMessage = "As observações podem ter até {1} caracteres.")]
    public string? Notes { get; init; }

    [Required(ErrorMessage = "Informe os itens do ambiente.")]
    [MaxLength(RoomConfiguration.ItemsMax, ErrorMessage = "O ambiente pode ter até {1} itens.")]
    public List<UpsertInspectionItemDto> Items { get; init; } = [];
}

public sealed record UpsertInspectionItemDto
{
    [Required(ErrorMessage = "Informe o id do item.")]
    public Guid? Id { get; init; }

    [Required(ErrorMessage = "Informe o nome do item.")]
    [StringLength(InspectionItemConfiguration.NameMaxLength, MinimumLength = InspectionItemConfiguration.NameMinLength,
        ErrorMessage = "O nome do item precisa ter de {2} a {1} caracteres.")]
    public string Name { get; init; } = "";

    [Required(ErrorMessage = "Informe a posição do item.")]
    [Range(0, int.MaxValue, ErrorMessage = "A posição não pode ser negativa.")]
    public int? Position { get; init; }

    // Nula até o item ser avaliado.
    public ItemCondition? Condition { get; init; }

    [MaxLength(InspectionItemConfiguration.NotesMaxLength, ErrorMessage = "As observações podem ter até {1} caracteres.")]
    public string? Notes { get; init; }
}

/// <summary>
/// <c>version</c> é o mesmo base64 do <c>ETag</c>, sem aspas, e é a versão do agregado inteiro. Ambientes e itens em
/// ordem de <c>position</c>; os excluídos não aparecem.
/// </summary>
public sealed record InspectionDto(
    Guid Id,
    Guid PropertyId,
    InspectionKind Kind,
    InspectionStatus Status,
    Guid? ReferenceInspectionId,
    DateTimeOffset StartedAt,
    DateTimeOffset? CompletedAt,
    string? GeneralNotes,
    IReadOnlyList<RoomDto> Rooms,
    string Version,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record RoomDto(Guid Id, string Name, int Position, string? Notes, IReadOnlyList<InspectionItemDto> Items);

/// <summary><c>referenceCondition</c> e <c>referenceNotes</c> só existem na saída: a cópia da entrada, somente leitura.</summary>
public sealed record InspectionItemDto(
    Guid Id,
    string Name,
    int Position,
    ItemCondition? Condition,
    string? Notes,
    ItemCondition? ReferenceCondition,
    string? ReferenceNotes);
