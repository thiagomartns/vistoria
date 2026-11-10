using MapsterMapper;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories;

namespace Vistoria.Api.Services.Impl;

public class InspectionService(
    IInspectionRepository inspections, IRepository<Property> properties, IMapper mapper, TimeProvider time)
    : SyncEntityService<Inspection, InspectionDto>(inspections, mapper), IInspectionService
{
    private readonly IMapper _mapper = mapper;

    public Task<(InspectionDto Inspection, bool Created)> UpsertAsync(
        Guid ownerId, Guid id, string? ifMatch, UpsertInspectionDto request, CancellationToken cancellationToken) =>
        UpsertAsync(ownerId, id, ifMatch, _mapper.Map<Inspection>(request), cancellationToken);

    // Concluída não muda mais (backend.md, "Regra do agregado").
    protected override bool IsLocked(Inspection current) => current.Status == InspectionStatus.Completed;

    // O que as Data Annotations não alcançam. Imóvel (ou entrada de referência) de outro dono responde igual ao
    // inexistente, para o id dele não vazar. A vistoria concluída (inclusive a que já nasce concluída, feita toda
    // offline) ganha o CompletedAt aqui; o que o cliente mandou nele nunca chega ao modelo. Kind e referência são da
    // criação (ADR 0051): na regravação, ficam os do registro atual, e as cópias dos itens, o repositório não toca.
    protected override async Task ValidateAsync(
        Inspection proposed, Inspection? current, Guid ownerId, CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var completing = proposed.Status == InspectionStatus.Completed;
        if (completing)
        {
            CompletionErrors(proposed, errors);
        }

        var property = await properties.FindByIdAsync(proposed.PropertyId, cancellationToken);
        if (property is null || property.OwnerId != ownerId)
        {
            errors["propertyId"] = ["Imóvel não encontrado."];
        }

        if (current is null)
        {
            await ReferenceErrors(proposed, ownerId, errors, cancellationToken);
        }
        else
        {
            (proposed.Kind, proposed.ReferenceInspectionId) = (current.Kind, current.ReferenceInspectionId);
            if (current.ReferenceInspectionId is not null && proposed.PropertyId != current.PropertyId
                && !errors.ContainsKey("propertyId"))
            {
                errors["propertyId"] = ["A saída fica no imóvel da entrada de referência."];
            }
        }

        var paths = ChildPaths(proposed, errors);
        if (paths.Count > 0)
        {
            var taken = await inspections.FindChildIdsOfOtherInspectionsAsync(
                proposed.Id,
                [.. paths.Where(p => p.IsRoom).Select(p => p.Id)],
                [.. paths.Where(p => !p.IsRoom).Select(p => p.Id)],
                cancellationToken);
            foreach (var (_, path, _) in paths.Where(p => taken.Contains(p.Id)))
            {
                errors[path] = ["Id já usado em outra vistoria."];
            }
        }

        if (errors.Count > 0)
        {
            throw new ValidationException(errors);
        }

        proposed.CompletedAt = completing ? time.GetUtcNow() : null;
    }

    // Na criação: a saída aponta para uma entrada concluída, viva, do mesmo imóvel e do mesmo dono; a entrada não tem
    // referência nem cópia nos itens. Elemento nulo já é erro do ChildPaths.
    private async Task ReferenceErrors(
        Inspection proposed, Guid ownerId, Dictionary<string, string[]> errors, CancellationToken cancellationToken)
    {
        if (proposed.Kind == InspectionKind.MoveIn)
        {
            if (proposed.ReferenceInspectionId is not null)
            {
                errors["referenceInspectionId"] = ["Só a vistoria de saída tem entrada de referência."];
            }

            for (var r = 0; r < proposed.Rooms.Count; r++)
            {
                var items = proposed.Rooms[r]?.Items ?? [];
                for (var i = 0; i < items.Count; i++)
                {
                    if (items[i] is { ReferenceCondition: not null })
                    {
                        errors[$"rooms[{r}].items[{i}].referenceCondition"] =
                            ["Só a vistoria de saída tem a condição da entrada."];
                    }

                    if (items[i] is { ReferenceNotes: not null })
                    {
                        errors[$"rooms[{r}].items[{i}].referenceNotes"] =
                            ["Só a vistoria de saída tem as observações da entrada."];
                    }
                }
            }

            return;
        }

        if (proposed.ReferenceInspectionId is not { } referenceId)
        {
            errors["referenceInspectionId"] = ["Informe a vistoria de entrada de referência."];
            return;
        }

        var reference = await inspections.FindByIdAsync(referenceId, cancellationToken);
        string? refusal = reference switch
        {
            null => "Vistoria de entrada não encontrada.",
            _ when reference.OwnerId != ownerId => "Vistoria de entrada não encontrada.",
            { Kind: not InspectionKind.MoveIn } => "A referência precisa ser uma vistoria de entrada.",
            { Status: not InspectionStatus.Completed } => "A vistoria de entrada precisa estar concluída.",
            _ when reference.PropertyId != proposed.PropertyId => "A vistoria de entrada é de outro imóvel.",
            _ => null,
        };
        if (refusal is not null)
        {
            errors["referenceInspectionId"] = [refusal];
        }
    }

    // Para concluir: ao menos um ambiente, ao menos um item em cada um e todos os itens avaliados. Elemento nulo já é
    // erro do ChildPaths.
    private static void CompletionErrors(Inspection proposed, Dictionary<string, string[]> errors)
    {
        if (proposed.Rooms.Count == 0)
        {
            errors["rooms"] = ["Para concluir, a vistoria precisa de ao menos um ambiente."];
        }

        for (var r = 0; r < proposed.Rooms.Count; r++)
        {
            if (proposed.Rooms[r] is not { } room)
            {
                continue;
            }

            if (room.Items.Count == 0)
            {
                errors[$"rooms[{r}].items"] = ["Para concluir, o ambiente precisa de ao menos um item."];
            }

            for (var i = 0; i < room.Items.Count; i++)
            {
                if (room.Items[i] is { Condition: null })
                {
                    errors[$"rooms[{r}].items[{i}].condition"] = ["Para concluir, avalie a condição do item."];
                }
            }
        }
    }

    // Elemento nulo (o validador do MVC o pula) e id repetido. Os ids são únicos na vistoria toda, não só no ambiente:
    // são a chave dos ambientes e itens no banco. Devolve o caminho de cada id que passou, para a consulta no banco.
    private static List<(Guid Id, string Path, bool IsRoom)> ChildPaths(
        Inspection proposed, Dictionary<string, string[]> errors)
    {
        var paths = new List<(Guid Id, string Path, bool IsRoom)>();
        var roomIds = new HashSet<Guid>();
        var itemIds = new HashSet<Guid>();
        for (var r = 0; r < proposed.Rooms.Count; r++)
        {
            var room = proposed.Rooms[r];
            if (room is null)
            {
                errors[$"rooms[{r}]"] = ["Informe o ambiente."];
                continue;
            }

            if (roomIds.Add(room.Id))
            {
                paths.Add((room.Id, $"rooms[{r}].id", true));
            }
            else
            {
                errors[$"rooms[{r}].id"] = ["Id de ambiente repetido na vistoria."];
            }

            for (var i = 0; i < room.Items.Count; i++)
            {
                var item = room.Items[i];
                if (item is null)
                {
                    errors[$"rooms[{r}].items[{i}]"] = ["Informe o item."];
                }
                else if (itemIds.Add(item.Id))
                {
                    paths.Add((item.Id, $"rooms[{r}].items[{i}].id", false));
                }
                else
                {
                    errors[$"rooms[{r}].items[{i}].id"] = ["Id de item repetido na vistoria."];
                }
            }
        }

        return paths;
    }
}
